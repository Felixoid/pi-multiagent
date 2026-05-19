import { spawn } from "node:child_process";
import { createRunArtifactStore, cleanupRunArtifacts, type RunArtifactStore } from "./background-artifacts.ts";
import { BackgroundEventStore } from "./background-events.ts";
import { buildDelegatedTask, writePromptFile } from "./delegated-prompt.ts";
import { isTerminalRunStatus, isTerminalStepStatus } from "./detached-output.ts";
import { selectOutputsForAction } from "./detached-output-selection.ts";
import { forgetDetachedRun } from "./detached-registry.ts";
import { createPendingStepState, type StepState } from "./detached-state.ts";
import { summarizeBackgroundEvent } from "./event-summary.ts";
import { createStepActivityTracker } from "./step-activity.ts";
import { validateLaunchCwd } from "./launch-cwd.ts";
import { findStepLaunchDenial } from "./launch-denial.ts";
import { createMessageReceiptCache } from "./message-idempotency.ts";
import { RpcChildController, type RpcStepResult } from "./rpc-child-controller.ts";
import { RunNotifier, stepNoticeReasons, terminalStepNoticeReasons } from "./run-notifier.ts";
import type { DetachedRunDetailsOptions, DetachedRunEventInput } from "./detached-run-options.ts";
import { terminalRunStatus } from "./run-terminal-status.ts";
import { RunWaiters } from "./run-waiters.ts";
import { safeRuntimeCallback } from "./runtime-diagnostics.ts";
import { makeDetails, type AgentTeamRuntimeOptions, unrefTimer } from "./runtime-options.ts";
import { buildRunSnapshot, buildStepSnapshots, countStepStatuses, findSinkStepIds } from "./run-snapshot.ts";
import { createStepOutputArtifact } from "./step-output-artifact.ts";
import { stalledStepBlockerMessage } from "./stalled-step-diagnostics.ts";
import { collectUpstreamOutputs } from "./upstream-outputs.ts";
import type { AgentDiagnostic, AgentTeamDetails, CleanupReceipt, LibraryOptions, MessageChannel, MessageReceipt, ResolvedGraph, RunSnapshot, RunStatus, StepStatus, TeamStepSpec } from "./types.ts";
import { DEFAULT_RESULT_PREVIEW_MAX_BYTES } from "./types.ts";

export class DetachedRun {
	readonly id: string;
	readonly createdAt = new Date().toISOString();
	private readonly graph: ResolvedGraph;
	private readonly options: AgentTeamRuntimeOptions;
	private readonly library: LibraryOptions;
	private updatedAt = this.createdAt;
	private status: RunStatus = "running";
	private readonly events = new BackgroundEventStore();
	private readonly stepActivity = createStepActivityTracker();
	private readonly artifactStore: RunArtifactStore;
	private readonly states = new Map<string, StepState>();
	private readonly messageReceipts = createMessageReceiptCache();
	private readonly diagnostics: AgentDiagnostic[];
	private readonly notifier: RunNotifier;
	private expiryRequested = false;
	private maxRunTimer: ReturnType<typeof setTimeout> | undefined;
	private retentionTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly waiters = new RunWaiters();

	constructor(id: string, graph: ResolvedGraph, options: AgentTeamRuntimeOptions, library: LibraryOptions) {
		this.id = id;
		this.graph = graph;
		this.options = options;
		this.library = library;
		this.diagnostics = [...graph.diagnostics];
		this.artifactStore = createRunArtifactStore();
		this.notifier = new RunNotifier({ runId: id, notify: graph.options.notify, runtimeOptions: options, recordDiagnostic: (code, label, message) => this.recordDiagnostic(code, label, message), isTerminal: () => this.snapshot().terminal, details: (notice) => this.details("run_status", { notice }) });
		for (const step of graph.steps) this.states.set(step.id, createPendingStepState(step));
	}

	start(): void {
		this.appendEvent({ type: "run", label: "start", preview: `runId=${this.id}`, status: "running" });
		this.maxRunTimer = setTimeout(() => this.expire(), this.graph.options.maxRunSeconds * 1000);
		unrefTimer(this.maxRunTimer);
		queueMicrotask(() => void this.schedule());
	}

	hasStep(stepId: string) {
		return this.states.has(stepId);
	}

	async waitForChange(input: { stepId?: string; cursor?: string; seconds: number }): Promise<void> {
		if (input.seconds <= 0 || this.snapshot().terminal) return;
		const sinks = this.sinkStepIds();
		if (this.events.hasMaterialAfter(input.cursor ?? this.events.currentCursor(), input.stepId, sinks)) return;
		await this.waiters.add({ stepId: input.stepId, sinkStepIds: sinks, milliseconds: input.seconds * 1000 });
	}

	async message(stepId: string, channel: MessageChannel, text: string, clientMessageId: string | undefined) {
		const hit = this.messageReceipts.lookup(stepId, channel, text, clientMessageId);
		if (hit === "conflict") return this.messageReceipt(stepId, channel, clientMessageId, false, "Conflicting clientMessageId");
		if (hit) return hit;
		let done: (receipt: MessageReceipt) => void = () => {};
		const pending = new Promise<MessageReceipt>((resolve) => { done = resolve; });
		const reserved = this.messageReceipts.reserve(stepId, channel, text, clientMessageId, pending);
		if (reserved === "conflict") return this.messageReceipt(stepId, channel, clientMessageId, false, "Conflicting clientMessageId");
		if (reserved) return reserved;
		const settle = (receipt: MessageReceipt) => {
			this.messageReceipts.settle(stepId, channel, text, clientMessageId, receipt);
			done(receipt);
			return receipt;
		};
		const state = this.states.get(stepId);
		if (!state || !state.controller || state.status !== "running" || this.status !== "running") return settle(this.messageReceipt(stepId, channel, clientMessageId, false, "Step not live or messageable."));
		let receipt: MessageReceipt;
		try {
			const ack = await state.controller.message(channel, text);
			receipt = this.messageReceipt(stepId, channel, clientMessageId, ack.success, ack.error, false);
		} catch (error) {
			receipt = this.messageReceipt(stepId, channel, clientMessageId, false, error instanceof Error ? error.message : String(error));
		}
		return settle(receipt);
	}

	cancel(reason?: string, options: { forceKill?: boolean } = {}) {
		if (this.snapshot().terminal) return;
		this.status = "canceling";
		this.touch();
		this.appendEvent({ type: "run", label: "cancel", preview: reason ?? "cancel", status: "running" });
		for (const state of this.states.values()) {
			if (state.status === "pending") this.finishState(state, "canceled", reason ?? "Canceled before start.");
			else if (state.status === "running" && state.controller) {
				state.controller.cancel(reason);
				if (options.forceKill) state.controller.forceKill(reason ?? "kill");
			} else if (state.status === "running") this.finishState(state, "canceled", reason ?? "Canceled before launch.");
		}
		void this.schedule();
	}

	cleanup(): CleanupReceipt {
		const deletedPaths = cleanupRunArtifacts(this.artifactStore);
		if (this.maxRunTimer) clearTimeout(this.maxRunTimer);
		if (this.retentionTimer) clearTimeout(this.retentionTimer);
		this.notifier.cancelTimers();
		this.appendEvent({ type: "run", label: "cleanup", preview: `${deletedPaths.length} paths deleted`, status: "done" });
		return { runId: this.id, deletedPaths };
	}

	details(action: AgentTeamDetails["action"], options: DetachedRunDetailsOptions = {}): AgentTeamDetails {
		const includeEvents = options.includeEvents === true;
		const delta = includeEvents ? this.events.delta(options.cursor, options.stepId, options.maxBytes ?? DEFAULT_RESULT_PREVIEW_MAX_BYTES) : { events: [], cursor: this.events.currentCursor() };
		return makeDetails(action, options.ok ?? true, this.diagnostics, this.options, { library: this.library, run: this.snapshot(), cursor: delta.cursor, events: delta.events, steps: this.stepSnapshots(), outputs: selectOutputsForAction(action, options.stepId, options.maxBytes ?? DEFAULT_RESULT_PREVIEW_MAX_BYTES, options.preview === true, this.states.values(), this.sinkStepIds()), message: options.message, cleanup: options.cleanup, notice: options.notice }, options.error);
	}

	snapshot(): RunSnapshot {
		const liveStepIds = this.stepSnapshots().filter((step) => step.status === "running").map((step) => step.id);
		return buildRunSnapshot({ runId: this.id, objective: this.graph.objective, status: this.status, createdAt: this.createdAt, updatedAt: this.updatedAt, retentionSeconds: this.graph.options.terminalRetentionSeconds, liveStepIds, sinkStepIds: this.sinkStepIds(), lastEvent: this.lastEventSummary(), canMessage: this.status === "running" && liveStepIds.length > 0, canCancel: this.status === "running" || this.status === "canceling", counts: this.counts() });
	}

	private async schedule() {
		while (this.status === "running" || this.status === "canceling") {
			let progressed = this.blockFailedDependents();
			progressed = this.startReadySteps() || progressed;
			const running = [...this.states.values()].filter((state) => state.promise !== undefined).map((state) => state.promise as Promise<void>);
			if (running.length === 0) {
				this.finalizeIfDone();
				if (this.snapshot().terminal) return;
				if (!progressed) {
					this.blockStalledPendingSteps();
					this.finalizeIfDone();
					return;
				}
				continue;
			}
			await Promise.race(running);
		}
	}

	private startReadySteps() {
		if (this.status !== "running") return false;
		let progressed = false;
		let slots = this.graph.limits.concurrency - [...this.states.values()].filter((state) => state.status === "running").length;
		if (slots <= 0) return false;
		for (const state of this.states.values()) {
			if (this.status !== "running" || slots <= 0) return progressed;
			if (state.status !== "pending" || !this.dependenciesReady(state.spec)) continue;
			const result = this.startStep(state);
			progressed = result.progressed || progressed;
			if (result.startedChild) slots -= 1;
		}
		return progressed;
	}

	private startStep(state: StepState) {
		const denial = findStepLaunchDenial(state.spec);
		if (denial) {
			this.finishState(state, "failed", denial);
			return { progressed: true, startedChild: false };
		}
		state.status = "running";
		state.startedAt = now();
		this.touch();
		this.appendEvent({ stepId: state.spec.id, type: "step", label: "start", preview: state.spec.agent.ref, status: "running" });
		state.promise = this.runStep(state).finally(() => {
			state.promise = undefined;
			void this.schedule();
		});
		return { progressed: true, startedChild: true };
	}

	private async runStep(state: StepState) {
		try {
			if (state.status !== "running" || this.status !== "running") return;
			const promptPath = writePromptFile(state.spec.agent, this.artifactStore, state.spec.id);
			if (state.status !== "running" || this.status !== "running") return;
			const launchDenial = findStepLaunchDenial(state.spec);
			if (launchDenial) {
				this.finishState(state, "failed", launchDenial);
				return;
			}
			const cwdDenial = validateLaunchCwd(state.spec);
			if (cwdDenial) {
				this.finishState(state, "failed", cwdDenial);
				return;
			}
			const task = buildDelegatedTask(this.graph.objective, state.spec, collectUpstreamOutputs(state.spec, this.states));
			const controller = new RpcChildController({
				agent: state.spec.agent,
				defaults: this.options.defaults,
				limits: this.graph.limits,
				cwd: state.spec.cwd,
				promptPath,
				spawnProcess: this.options.spawnProcess ?? spawn,
				ackTimeoutMs: this.options.rpcCommandAckTimeoutMs,
				onText: (text) => this.updateLiveText(state, text),
				onEvent: (event) => this.appendEvent({ ...event, stepId: state.spec.id }),
			});
			state.controller = controller;
			this.finishFromRpcResult(state, await controller.run(task));
		} catch (error) {
			this.finishState(state, "failed", error instanceof Error ? error.message : String(error));
		}
	}

	private finishFromRpcResult(state: StepState, result: RpcStepResult) {
		const status = result.status === "timed_out" || result.status === "canceled" || result.status === "failed" ? result.status : "succeeded";
		state.finalText = result.text;
		state.assistantFinals = result.assistantFinals;
		state.output = this.createStepOutput(state, status, result.text, result.assistantFinals);
		if (result.stderr.length > 0) this.appendEvent({ stepId: state.spec.id, type: "diagnostic", label: "stderr", preview: result.stderr, status: "done" });
		this.finishState(state, status, result.errorMessage);
	}

	private createStepOutput(state: StepState, status: StepStatus, text: string, assistantFinals: string[] = []) {
		return createStepOutputArtifact({ runId: this.id, objective: this.graph.objective, artifactStore: this.artifactStore, diagnostics: this.diagnostics, events: this.events, state, status, text, assistantFinals });
	}

	private updateLiveText(state: StepState, text: string) {
		if (text === state.liveText) return;
		const previousEventChars = state.liveTextEventChars;
		state.liveText = text;
		if (previousEventChars === 0 || text.length - previousEventChars >= 1000) {
			state.liveTextEventChars = text.length;
			this.appendEvent({ stepId: state.spec.id, type: "assistant_delta", label: "text", preview: text, status: "running" });
		}
		this.touch();
	}

	private finishState(state: StepState, status: StepStatus, errorMessage: string | undefined) {
		if (isTerminalStepStatus(state.status)) return;
		if (!state.output) {
			const text = errorMessage ?? "";
			state.finalText = text;
			state.output = this.createStepOutput(state, status, text);
		}
		state.status = status;
		state.endedAt = now();
		state.errorMessage = errorMessage;
		state.controller = undefined;
		this.touch();
		this.appendEvent({ stepId: state.spec.id, type: "step", label: "finish", preview: errorMessage ?? status, status });
		this.finalizeIfDone();
		if (this.status === "running" && !this.snapshot().terminal) this.queueStepNotice(state, status);
	}

	private finalizeIfDone() {
		if (isTerminalRunStatus(this.status)) return;
		const snapshots = this.stepSnapshots();
		if (snapshots.some((step) => !isTerminalStepStatus(step.status))) return;
		this.status = terminalRunStatus({ currentStatus: this.status, expiryRequested: this.expiryRequested, steps: snapshots });
		this.touch();
		if (this.maxRunTimer) clearTimeout(this.maxRunTimer);
		this.appendEvent({ type: "run", label: "terminal", preview: this.status, status: "done" });
		this.notifier.sendTerminal(this.status, terminalStepNoticeReasons(snapshots));
		this.scheduleRetention();
	}

	private expire() {
		if (isTerminalRunStatus(this.status)) return;
		this.expiryRequested = true;
		this.status = "canceling";
		this.touch();
		this.appendEvent({ type: "run", label: "expired", preview: "maxRunSeconds exceeded", status: "error" });
		for (const state of this.states.values()) {
			if (state.status === "pending") this.finishState(state, "canceled", "Run expired pre-start.");
			else if (state.status === "running" && state.controller) state.controller.cancel("Run expired.");
			else if (state.status === "running") this.finishState(state, "timed_out", "Expired before launch.");
		}
		void this.schedule();
	}

	private blockFailedDependents() {
		let changed = false;
		for (const state of this.states.values()) {
			if (state.status !== "pending") continue;
			const failed = state.spec.needs.filter((need) => {
				const dep = this.states.get(need);
				return dep !== undefined && isTerminalStepStatus(dep.status) && dep.status !== "succeeded";
			});
			if (failed.length > 0) {
				this.finishState(state, "blocked", `Dependency failed: ${failed.join(", ")}.`);
				changed = true;
			}
		}
		return changed;
	}

	private blockStalledPendingSteps() {
		for (const state of this.states.values()) {
			if (state.status === "pending") this.finishState(state, "blocked", stalledStepBlockerMessage(state.spec, (id) => this.states.get(id)?.status ?? "missing"));
		}
	}

	private dependenciesReady(step: TeamStepSpec) {
		return step.needs.every((need) => this.states.get(need)?.status === "succeeded") && step.after.every((after) => isTerminalStepStatus(this.states.get(after)?.status ?? "pending"));
	}

	private scheduleRetention() {
		this.retentionTimer = setTimeout(() => {
			try {
				this.cleanup();
				forgetDetachedRun(this.id);
			} catch (error) {
				this.recordDiagnostic("retention-cleanup-failed", "cleanup", error instanceof Error ? error.message : String(error));
			}
		}, this.graph.options.terminalRetentionSeconds * 1000);
		unrefTimer(this.retentionTimer);
	}

	private sinkStepIds() { return findSinkStepIds(this.graph.steps); }
	private lastEventSummary() { return summarizeBackgroundEvent(this.events.last()); }
	private stepSnapshots() { return buildStepSnapshots(this.states.values(), this.stepActivity); }
	private counts() { return countStepStatuses(this.states.values()); }

	private messageReceipt(stepId: string, channel: MessageChannel, clientMessageId: string | undefined, accepted: boolean, undeliveredReason: string | undefined, recordEvent = true) {
		const receipt = { runId: this.id, stepId, channel, clientMessageId, accepted, undeliveredReason, reused: false };
		if (recordEvent) this.appendEvent({ stepId, type: "parent_message", label: channel, preview: accepted ? "accepted/queued" : undeliveredReason, status: accepted ? "done" : "error" });
		return receipt;
	}

	private appendEvent(input: DetachedRunEventInput) {
		const event = this.events.append(input);
		this.stepActivity.record(event);
		this.waiters.notify(event);
		if (this.status === "running" && input.type === "diagnostic" && input.label !== "agent_team-notice") this.notifier.queueMilestone(`diagnostic:${input.label ?? "event"}`);
	}

	private recordDiagnostic(code: string, label: string, message: string) {
		if (!this.diagnostics.some((item) => item.code === code && item.message === message)) this.diagnostics.push({ code, message, path: undefined, severity: "warning" });
		this.appendEvent({ type: "diagnostic", label, preview: message, status: "error" });
	}

	private queueStepNotice(state: StepState, status: StepStatus) {
		if (this.graph.options.notify.mode !== "milestones") return;
		for (const reason of stepNoticeReasons({ stepId: state.spec.id, status, sinkStepIds: this.sinkStepIds() })) this.notifier.queueMilestone(reason);
	}

	private touch() {
		this.updatedAt = now();
		const errorMessage = safeRuntimeCallback(() => this.options.onRunUpdate?.(this.details("run_status")), "agent_team UI failed");
		if (errorMessage) this.recordDiagnostic("run-ui-callback-failed", "run-ui", errorMessage);
	}
}

function now(): string {
	return new Date().toISOString();
}
