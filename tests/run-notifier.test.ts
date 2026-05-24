import assert from "node:assert/strict";
import test from "node:test";
import { RunNotifier, terminalStepNoticeReasons } from "../extensions/multiagent/src/run-notifier.ts";
import type { AgentTeamDetails, StepSnapshot } from "../extensions/multiagent/src/types.ts";

function runtimeOptions(onNotice: (details: AgentTeamDetails) => void) {
	return {
		cwd: process.cwd(),
		packageAgentsDir: process.cwd(),
		materializationDiagnostics: [],
		catalogLibrary: { sources: ["package"], query: undefined },
		catalogPreparationDiagnostics: [],
		defaults: { model: undefined, thinking: undefined },
		parentTools: { apiAvailable: true, errorMessage: undefined, tools: [] },
		parentSkills: { apiAvailable: true, readActive: true, errorMessage: undefined, skills: [] },
		signal: undefined,
		onUpdate: undefined,
		onRunNotice: (details: AgentTeamDetails) => {
			onNotice(details);
			return undefined;
		},
		spawnProcess: undefined,
	};
}

test("RunNotifier coalesces milestones inside minInterval and preserves terminal notice", async () => {
	const diagnostics: string[] = [];
	const notices: AgentTeamDetails[] = [];
	const notifier = new RunNotifier({
		runId: "r1",
		notify: { mode: "milestones", maxNotices: 3, minIntervalSeconds: 0.03 },
		runtimeOptions: runtimeOptions((details) => notices.push(details)),
		recordDiagnostic: (code, _label, message) => diagnostics.push(`${code}:${message}`),
		isTerminal: () => false,
		details: (notice) => ({ kind: "agent_team", action: "run_status", ok: true, diagnostics: [], error: undefined, library: undefined, catalog: [], extensionTools: [], run: undefined, cursor: undefined, events: [], steps: [], outputs: [], message: undefined, cleanup: undefined, notice }),
	});
	notifier.queueMilestone("sink first succeeded");
	notifier.queueMilestone("step second failed");
	notifier.queueMilestone("diagnostic:stderr");
	await new Promise((resolve) => setTimeout(resolve, 60));
	notifier.sendTerminal("mixed");
	assert.equal(diagnostics.length, 0);
	assert.equal(notices.length, 3);
	assert.deepEqual(notices[0].notice?.reasons, ["sink first succeeded"]);
	assert.deepEqual(notices[1].notice?.reasons.sort(), ["diagnostic:stderr", "step second failed"].sort());
	assert.equal(notices[1].notice?.terminal, false);
	assert.equal(notices[2].notice?.terminal, true);
	assert.deepEqual(notices[2].notice?.reasons, ["terminal:mixed"]);
});

test("RunNotifier records notice callback failures without throwing", () => {
	const diagnostics: string[] = [];
	const notifier = new RunNotifier({
		runId: "r1",
		notify: { mode: "final", maxNotices: 0, minIntervalSeconds: 0 },
		runtimeOptions: runtimeOptions(() => { throw new Error("notice failed"); }),
		recordDiagnostic: (code, label, message) => diagnostics.push(`${code}:${label}:${message}`),
		isTerminal: () => false,
		details: (notice) => ({ kind: "agent_team", action: "run_status", ok: true, diagnostics: [], error: undefined, library: undefined, catalog: [], extensionTools: [], run: undefined, cursor: undefined, events: [], steps: [], outputs: [], message: undefined, cleanup: undefined, notice }),
	});
	assert.doesNotThrow(() => notifier.sendTerminal("succeeded"));
	assert.equal(diagnostics.length, 1);
	assert.match(diagnostics[0] ?? "", /run-notice-callback-failed:agent_team-notice:Could not send agent_team notice: notice failed/);
});

test("terminalStepNoticeReasons names failed blocked and timed out steps only", () => {
	const steps: StepSnapshot[] = [
		step("ok", "succeeded"),
		step("bad", "failed"),
		step("blocked", "blocked"),
		step("slow", "timed_out"),
		step("stopped", "canceled"),
	];
	assert.deepEqual(terminalStepNoticeReasons(steps), ["step bad failed", "step blocked blocked", "step slow timed_out"]);
});

function step(id: string, status: StepSnapshot["status"]): StepSnapshot {
	return {
		id,
		status,
		agentRef: "inline",
		model: undefined,
		thinking: undefined,
		effectiveTools: ["read", "grep", "find", "ls"],
		extensionTools: [],
		callerSkills: [],
		needs: [],
		after: [],
		startedAt: undefined,
		endedAt: undefined,
		lastActivity: undefined,
		errorMessage: undefined,
	};
}
