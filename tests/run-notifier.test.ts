import assert from "node:assert/strict";
import test from "node:test";
import { BackgroundEventStore } from "../extensions/multiagent/src/background-events.ts";
import { RunNotifier } from "../extensions/multiagent/src/run-notifier.ts";
import type { AgentDiagnostic, AgentTeamDetails } from "../extensions/multiagent/src/types.ts";

function runtimeOptions(onNotice: (details: AgentTeamDetails) => void) {
	return {
		cwd: process.cwd(),
		packageAgentsDir: process.cwd(),
		materializationDiagnostics: [],
		catalogLibrary: { sources: ["package"], query: undefined, projectAgents: "deny" },
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
	const diagnostics: AgentDiagnostic[] = [];
	const events = new BackgroundEventStore();
	const notices: AgentTeamDetails[] = [];
	const notifier = new RunNotifier({
		runId: "agt_abcdefghijklmnopqrstuvwxyzABCDEF1234567890-_",
		notify: { mode: "milestones", maxNotices: 3, minIntervalSeconds: 0.03 },
		diagnostics,
		events,
		runtimeOptions: runtimeOptions((details) => notices.push(details)),
		isTerminal: () => false,
		details: (notice) => ({ kind: "agent_team", action: "retrieve", ok: true, diagnostics: [], error: undefined, library: undefined, catalog: [], extensionTools: [], run: undefined, cursor: undefined, events: [], steps: [], outputs: [], message: undefined, cleanup: undefined, notice }),
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
