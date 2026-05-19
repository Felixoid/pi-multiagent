import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { AssistantOutputBudget, type OutputBudgetFailure } from "./rpc-output-budget.ts";
import { RpcCommandQueue, type RpcCommandAck } from "./rpc-command-queue.ts";
import { combinedAssistantFinals, envelopeParentMessage, extractAgentEndErrorMessage, extractAgentEndStopReason, extractAssistantErrorMessage, extractAssistantStopReason, extractAssistantText, extractEventText, isRecord, stringField } from "./rpc-record-utils.ts";
import { STDERR_PREVIEW_CHARS, type AgentInvocationDefaults, type ResolvedAgent, type StepStatus, type TeamLimits } from "./types.ts";
import { buildPiArgs, getPiInvocation, killProcessTree, type SpawnProcess } from "./child-launch.ts";
import { serializeRpcJsonLine, type RpcJsonRecord } from "./rpc-jsonl.ts";
import { RpcChildListeners } from "./rpc-child-listeners.ts";
import { ParentMessageBudget } from "./rpc-parent-message-budget.ts";

const ACK_TIMEOUT_MS = 10_000;
const EXIT_CLOSE_GRACE_MS = 500;
const SIGKILL_CONFIRM_MS = 250;
const SIGTERM_GRACE_MS = 250;

export interface RpcChildControllerOptions {
	agent: ResolvedAgent;
	defaults: AgentInvocationDefaults;
	limits: TeamLimits;
	cwd: string;
	promptPath: string;
	spawnProcess?: SpawnProcess;
	ackTimeoutMs?: number;
	onEvent: (input: { type: "rpc" | "assistant_final" | "tool" | "diagnostic" | "parent_message" | "ui"; label?: string; preview?: string; status?: string }) => void;
	onText?: (text: string) => void;
}

export interface RpcStepResult {
	status: StepStatus;
	text: string;
	assistantFinals: string[];
	stderr: string;
	errorMessage: string | undefined;
}

export class RpcChildController {
	private readonly options: RpcChildControllerOptions;
	private readonly commands: RpcCommandQueue;
	private child: ChildProcessWithoutNullStreams | undefined;
	private completionResolve: ((result: RpcStepResult) => void) | undefined;
	private closingResult: RpcStepResult | undefined;
	private finalized = false;
	private terminating = false;
	private childClosed = false;
	private childExited = false;
	private sawAgentEnd = false;
	private agentEndStopReason: string | undefined;
	private agentEndErrorMessage: string | undefined;
	private lastAssistantStopReason: string | undefined;
	private lastAssistantErrorMessage: string | undefined;
	private output = "";
	private assistantFinals: string[] = [];
	private readonly outputBudget = new AssistantOutputBudget();
	private liveText = "";
	private stderr = "";
	private readonly parentMessageBudget = new ParentMessageBudget();
	private timeoutTimer: ReturnType<typeof setTimeout> | undefined;
	private killTimer: ReturnType<typeof setTimeout> | undefined;
	private exitCloseTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly listeners = new RpcChildListeners();
	private spawnProcess: SpawnProcess;

	constructor(options: RpcChildControllerOptions) {
		this.options = options;
		this.spawnProcess = options.spawnProcess ?? spawn;
		const ackTimeoutMs = Number.isFinite(options.ackTimeoutMs) && options.ackTimeoutMs !== undefined && options.ackTimeoutMs > 0 ? Math.trunc(options.ackTimeoutMs) : ACK_TIMEOUT_MS;
		this.commands = new RpcCommandQueue(ackTimeoutMs);
	}

	async run(task: string): Promise<RpcStepResult> {
		const args = buildPiArgs(this.options.agent, this.options.defaults, this.options.promptPath);
		const invocation = getPiInvocation(args, this.options.cwd);
		this.child = this.spawnProcess(invocation.command, invocation.args, { cwd: this.options.cwd, shell: false, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
		this.options.onEvent({ type: "rpc", label: "spawn", preview: "child process spawned", status: "running" });
		this.listeners.attach(this.child, { onRecord: (record) => this.handleRecord(record), onStdoutError: (message) => this.handleStdoutError(message), onStderrData: (text) => this.appendStderr(text), onStderrError: (error) => this.handleStderrError(error), onStdinError: (error) => this.handleStdinError(error), onChildError: (error) => this.fail("failed", `Subagent process error: ${error.message}`), onExit: () => this.handleExit(), onClose: () => this.handleClose() });
		this.timeoutTimer = setTimeout(() => this.fail("timed_out", `Subagent exceeded timeoutSecondsPerStep=${this.options.limits.timeoutSecondsPerStep}.`), this.options.limits.timeoutSecondsPerStep * 1000);
		this.timeoutTimer.unref?.();
		const completion = new Promise<RpcStepResult>((resolve) => {
			this.completionResolve = resolve;
		});
		this.options.onEvent({ type: "rpc", label: "prompt", preview: "sent", status: "running" });
		const ack = await this.sendCommand({ type: "prompt", message: task });
		if (!ack.success) this.fail("failed", ack.error ?? "Initial prompt was rejected.");
		else this.options.onEvent({ type: "rpc", label: "prompt", preview: "accepted", status: "done" });
		return completion;
	}

	async message(channel: "steer" | "follow_up", text: string): Promise<RpcCommandAck> {
		if (this.finalized || this.closingResult || this.terminating) return { success: false, error: "Step is not live." };
		const budgetError = this.parentMessageBudget.reserve(text);
		if (budgetError) return { success: false, error: budgetError };
		const commandType = channel === "steer" ? "steer" : "follow_up";
		const ack = await this.sendCommand({ type: commandType, message: envelopeParentMessage(channel, text) });
		this.options.onEvent({ type: "parent_message", label: channel, preview: ack.success ? "accepted/queued" : ack.error, status: ack.success ? "done" : "error" });
		this.maybeFinalize();
		return ack;
	}

	cancel(reason: string | undefined): void {
		if (this.finalized || this.closingResult) return;
		this.options.onEvent({ type: "diagnostic", label: "cancel", preview: reason ?? "cancel requested", status: "running" });
		void this.sendCommand({ type: "abort" });
		this.fail("canceled", reason ?? "Run canceled.");
	}

	forceKill(reason: string): void {
		if (!this.child || this.childClosed || this.childExited) return;
		if (this.killTimer) clearTimeout(this.killTimer);
		this.options.onEvent({ type: "diagnostic", label: "SIGKILL", preview: reason, status: "error" });
		if (!killProcessTree(this.child, "SIGKILL")) this.options.onEvent({ type: "diagnostic", label: "SIGKILL", preview: "not accepted", status: "error" });
		if (this.closingResult) this.complete(this.closingResult);
	}

	private handleStdoutError(message: string): void {
		const normalized = message.startsWith("RPC JSONL stream error:") ? message.replace("RPC JSONL", "RPC stdout") : message;
		this.fail("failed", normalized, normalized.includes("stream error") ? "stdout-error" : "rpc-jsonl");
	}

	private handleStdinError(error: Error): void {
		const message = `RPC stdin stream error: ${error.message}`;
		if (this.finalized) return;
		if (this.closingResult) {
			this.options.onEvent({ type: "diagnostic", label: "stdin-error", preview: message, status: "error" });
			return;
		}
		this.fail("failed", message, "stdin-error");
	}

	private handleStderrError(error: Error): void {
		const message = `RPC stderr stream error: ${error.message}`;
		if (this.finalized) return;
		if (this.closingResult) {
			this.options.onEvent({ type: "diagnostic", label: "stderr-error", preview: message, status: "error" });
			return;
		}
		this.fail("failed", message, "stderr-error");
	}

	private sendCommand(command: RpcJsonRecord): Promise<RpcCommandAck> {
		if (this.finalized || this.closingResult) return Promise.resolve({ success: false, error: "RPC child is not live." });
		return this.commands.send(this.child?.stdin, command);
	}

	private handleRecord(record: RpcJsonRecord): void {
		if (this.finalized || this.closingResult) return;
		const type = typeof record.type === "string" ? record.type : "unknown";
		if (type === "response") {
			this.handleResponse(record);
			return;
		}
		if (type === "message_update") this.handleMessageUpdate(record);
		else if (type === "message_end") this.handleMessageEnd(record);
		else if (type === "agent_end") this.handleAgentEnd(record);
		else if (type === "tool_execution_start" || type === "tool_execution_update" || type === "tool_execution_end") this.handleToolEvent(type, record);
		else if (type === "extension_ui_request") this.handleUiRequest(record);
		else if (type === "extension_error") this.options.onEvent({ type: "diagnostic", label: "extension_error", preview: extractEventText(record), status: "error" });
		else this.options.onEvent({ type: "rpc", label: type, preview: extractEventText(record), status: undefined });
	}

	private handleResponse(record: RpcJsonRecord): void {
		this.commands.handleResponse(record, ({ command, message }) => this.options.onEvent({ type: "diagnostic", label: command, preview: message, status: "error" }));
		this.maybeFinalize();
	}

	private handleAgentEnd(record: RpcJsonRecord): void {
		this.sawAgentEnd = true;
		this.agentEndStopReason = extractAgentEndStopReason(record);
		this.agentEndErrorMessage = extractAgentEndErrorMessage(record);
		const preview = this.agentEndStopReason ? `stopReason=${this.agentEndStopReason}` : "terminal event observed";
		const suffix = this.agentEndErrorMessage ? `: ${this.agentEndErrorMessage}` : "";
		this.options.onEvent({ type: "rpc", label: "agent_end", preview: `${preview}${suffix}`, status: "done" });
		this.maybeFinalize();
	}

	private handleMessageUpdate(record: RpcJsonRecord): void {
		const event = isRecord(record.assistantMessageEvent) ? record.assistantMessageEvent : undefined;
		const eventType = typeof event?.type === "string" ? event.type : "unknown";
		if (eventType === "start") {
			this.liveText = "";
			this.outputBudget.resetLiveText();
			this.options.onText?.(this.liveText);
			this.options.onEvent({ type: "rpc", label: "message_start", preview: "assistant message started", status: "running" });
			return;
		}
		if (eventType === "text_delta") {
			const delta = stringField(event?.delta);
			if (delta === undefined) return;
			const check = this.outputBudget.appendLiveTextDelta(delta);
			if (!check.ok) {
				this.failOutputBudget(check.failure);
				return;
			}
			this.liveText = `${this.liveText}${delta}`;
			this.options.onText?.(this.liveText);
			return;
		}
		if (eventType === "text_end") {
			const content = stringField(event?.content);
			if (content === undefined) return;
			const check = this.outputBudget.measureText(content, "assistant text_end");
			if (!check.ok) {
				this.failOutputBudget(check.failure);
				return;
			}
			this.liveText = content;
			this.outputBudget.setLiveTextBytes(check.bytes);
			this.options.onText?.(this.liveText);
		}
	}

	private handleMessageEnd(record: RpcJsonRecord): void {
		const text = extractAssistantText(record);
		if (text === undefined) return;
		const stopReason = extractAssistantStopReason(record);
		const errorMessage = extractAssistantErrorMessage(record);
		this.lastAssistantStopReason = stopReason;
		this.lastAssistantErrorMessage = errorMessage;
		const check = this.outputBudget.measureText(text, "assistant final");
		if (!check.ok) {
			this.failOutputBudget(check.failure);
			return;
		}
		const nonEmpty = text.trim().length > 0;
		const finalFailure = nonEmpty ? this.outputBudget.canAcceptAssistantFinal(check.bytes) : undefined;
		if (finalFailure) {
			this.failOutputBudget(finalFailure);
			return;
		}
		this.output = text;
		this.liveText = text;
		this.outputBudget.setLiveTextBytes(check.bytes);
		this.options.onText?.(text);
		if (!nonEmpty) {
			this.options.onEvent({ type: "rpc", label: "assistant_final_empty", preview: "empty assistant final ignored", status: "done" });
			return;
		}
		if (stopReason && stopReason !== "stop") {
			const message = errorMessage ? `assistant message ended with stopReason ${stopReason}: ${errorMessage}` : `assistant message ended with stopReason ${stopReason}`;
			this.options.onEvent({ type: "rpc", label: "assistant_nonfinal", preview: message, status: stopReason === "tooluse" ? "done" : "error" });
			return;
		}
		this.outputBudget.recordAssistantFinal(check.bytes);
		this.assistantFinals.push(text);
		this.options.onEvent({ type: "assistant_final", label: "assistant", preview: text, status: "done" });
	}

	private failOutputBudget(failure: OutputBudgetFailure): void {
		this.fail("failed", failure.message, failure.label);
	}

	private handleToolEvent(type: string, record: RpcJsonRecord): void {
		const name = stringField(record.toolName) ?? "tool";
		const status = type === "tool_execution_end" ? "done" : "running";
		this.options.onEvent({ type: "tool", label: name, preview: type.replace("tool_execution_", ""), status });
	}

	private handleUiRequest(record: RpcJsonRecord): void {
		const method = typeof record.method === "string" ? record.method : "unknown";
		const id = typeof record.id === "string" ? record.id : undefined;
		this.options.onEvent({ type: "ui", label: method, preview: "unattended UI request denied", status: "error" });
		if (id && ["select", "confirm", "input", "editor"].includes(method)) void this.sendUiCancel(id);
		this.fail("failed", `Unattended extension UI request denied: ${method}.`);
	}

	private async sendUiCancel(id: string): Promise<void> {
		if (!this.child || this.finalized) return;
		try {
			this.child.stdin.write(serializeRpcJsonLine({ type: "extension_ui_response", id, cancelled: true }));
		} catch {
			// Closeout reports the UI denial.
		}
	}

	private maybeFinalize(): void {
		if (!this.sawAgentEnd || this.commands.pendingCount > 0 || this.finalized || this.closingResult) return;
		const stopReason = this.agentEndStopReason ?? this.lastAssistantStopReason;
		const errorMessage = this.agentEndErrorMessage ?? this.lastAssistantErrorMessage;
		if (stopReason && stopReason !== "stop") {
			const message = errorMessage ? `Subagent RPC ended with stopReason ${stopReason}: ${errorMessage}` : `Subagent RPC ended with stopReason ${stopReason}.`;
			this.fail("failed", message, stopReason === "error" ? "assistant-error" : "assistant-stop");
			return;
		}
		const text = combinedAssistantFinals(this.assistantFinals);
		if (text.trim().length === 0) {
			this.fail("failed", "assistant-final-empty: Subagent completed without assistant final text after agent_end and command acknowledgements; no non-empty terminal assistant text was captured.", "assistant-final-empty");
			return;
		}
		this.finalize({ status: "succeeded", text, assistantFinals: [...this.assistantFinals], stderr: this.stderr, errorMessage: undefined });
	}

	private failureResult(status: StepStatus, message: string): RpcStepResult {
		return { status, text: this.output, assistantFinals: [...this.assistantFinals], stderr: this.stderr, errorMessage: message };
	}

	private fail(status: StepStatus, message: string, label: string = status): void {
		if (this.finalized || this.closingResult) return;
		this.options.onEvent({ type: "diagnostic", label, preview: message, status: "error" });
		this.finalize(this.failureResult(status, message));
	}

	private finalize(result: RpcStepResult): void {
		if (this.finalized || this.closingResult) return;
		this.closingResult = result;
		this.options.onEvent({ type: "rpc", label: "terminalizing", preview: result.status, status: "running" });
		if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
		this.commands.closeWith((command) => `RPC command ${command} was closed by step finalization.`);
		this.listeners.detachIo(false, true);
		this.terminateChild();
		if (!this.child || this.childClosed || this.childExited || this.child.exitCode !== null) this.complete(result);
	}

	private handleExit(): void {
		this.childExited = true;
		if (this.childClosed || this.finalized) return;
		this.exitCloseTimer = setTimeout(() => {
			if (this.childClosed || this.finalized) return;
			if (this.closingResult) {
				this.options.onEvent({ type: "diagnostic", label: "process-exit", preview: `process exited before stdio close after ${EXIT_CLOSE_GRACE_MS}ms; step closeout forced`, status: "error" });
				this.complete(this.closingResult);
				return;
			}
			this.fail("failed", "Subagent RPC process exited before terminal agent_end.");
		}, EXIT_CLOSE_GRACE_MS);
		this.exitCloseTimer.unref?.();
	}

	private handleClose(): void {
		this.childClosed = true;
		if (this.killTimer) clearTimeout(this.killTimer);
		if (this.exitCloseTimer) clearTimeout(this.exitCloseTimer);
		if (this.closingResult) {
			this.complete(this.closingResult);
			return;
		}
		if (!this.finalized) this.fail("failed", "Subagent RPC process closed before terminal agent_end.");
	}

	private complete(result: RpcStepResult): void {
		if (this.finalized) return;
		this.finalized = true;
		if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
		if (this.killTimer) clearTimeout(this.killTimer);
		if (this.exitCloseTimer) clearTimeout(this.exitCloseTimer);
		this.listeners.detachForCompletion(!!this.child && !this.childClosed);
		this.completionResolve?.(result);
		this.completionResolve = undefined;
	}

	private terminateChild(): void {
		if (!this.child || this.terminating || this.childClosed || this.childExited) return;
		this.terminating = true;
		try {
			this.child.stdin.end();
		} catch {
			// SIGTERM below is the authoritative closeout attempt.
		}
		if (this.child.exitCode === null && !killProcessTree(this.child, "SIGTERM")) this.options.onEvent({ type: "diagnostic", label: "SIGTERM", preview: "not accepted", status: "error" });
		this.killTimer = setTimeout(() => {
			if (!this.child || this.childExited || this.child.exitCode !== null) return;
			if (!killProcessTree(this.child, "SIGKILL")) this.options.onEvent({ type: "diagnostic", label: "SIGKILL", preview: "not accepted", status: "error" });
			this.killTimer = setTimeout(() => {
				if (!this.child || this.childExited || this.child.exitCode !== null || !this.closingResult) return;
				this.options.onEvent({ type: "diagnostic", label: "SIGKILL", preview: `process still open after ${SIGKILL_CONFIRM_MS}ms; step closeout forced`, status: "error" });
				this.complete(this.closingResult);
			}, SIGKILL_CONFIRM_MS);
			this.killTimer.unref?.();
		}, SIGTERM_GRACE_MS);
		this.killTimer.unref?.();
	}

	private appendStderr(text: string): void {
		if (text.length === 0) return;
		this.stderr = `${this.stderr}${text}`;
		if (this.stderr.length > STDERR_PREVIEW_CHARS) this.stderr = this.stderr.slice(this.stderr.length - STDERR_PREVIEW_CHARS);
	}
}
