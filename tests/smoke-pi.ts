import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentTeam } from "../extensions/multiagent/src/delegation.ts";
import type { AgentTeamRuntimeOptions } from "../extensions/multiagent/src/runtime-options.ts";
import type { AgentTeamInput } from "../extensions/multiagent/src/schemas.ts";
import type { AgentTeamDetails, ParentSkillInventory, ParentToolInfo, ParentToolInventory } from "../extensions/multiagent/src/types.ts";
import { BUILTIN_CHILD_TOOL_NAMES } from "../extensions/multiagent/src/types.ts";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const enabled = process.env.PI_MULTIAGENT_REAL_SMOKE === "1";
const timeoutMs = Number(process.env.PI_MULTIAGENT_REAL_SMOKE_TIMEOUT_MS ?? "120000");
const expectedFinal = "pi-multiagent-real-smoke-ok";
const pollSeconds = 10;

if (!enabled) {
	throw new Error("Real Pi smoke is opt-in because it launches the installed Pi runtime and may call the configured model. Run PI_MULTIAGENT_REAL_SMOKE=1 pnpm run smoke:pi when preparing a release candidate.");
}

const options = makeOptions();
const started = await runAgentTeam(startInput(), options);
assert.equal(started.details.ok, true, `agent_team start failed:\n${started.content[0]?.text ?? ""}`);
const runId = started.details.run?.runId;
assert.equal(typeof runId, "string", `agent_team start did not return runId:\n${started.content[0]?.text ?? ""}`);

const terminal = await waitForTerminal(runId);
assert.equal(terminal.details.ok, true, `agent_team run_status failed:\n${terminal.content[0]?.text ?? ""}`);
assert.equal(terminal.details.run?.terminal, true, `agent_team run did not reach terminal state:\n${terminal.content[0]?.text ?? ""}`);
assert.equal(terminal.details.run?.status, "succeeded", `agent_team child run did not succeed:\n${terminal.content[0]?.text ?? ""}`);
assert.equal(terminal.details.outputs.some((output) => output.text?.trim() === expectedFinal), true, `child final was not exactly ${expectedFinal}:\n${terminal.content[0]?.text ?? ""}`);

const cleanup = await runAgentTeam({ action: "cleanup", runId }, options);
assert.equal(cleanup.details.ok, true, `cleanup failed after real smoke:\n${cleanup.content[0]?.text ?? ""}`);

async function waitForTerminal(runId: string): Promise<{ details: AgentTeamDetails; content: { type: "text"; text: string }[] }> {
	const deadline = Date.now() + timeoutMs;
	let latest: Awaited<ReturnType<typeof runAgentTeam>> | undefined;
	while (Date.now() < deadline) {
		latest = await runAgentTeam({ action: "run_status", runId, waitSeconds: pollSeconds, preview: true, maxBytes: 4000 }, options);
		if (latest.details.run?.terminal) return latest;
	}
	throw new Error(`Timed out after ${timeoutMs}ms waiting for real child Pi smoke. Latest status:\n${latest?.content[0]?.text ?? "none"}`);
}

function startInput(): AgentTeamInput {
	return {
		action: "start",
		graph: {
			objective: "Real child Pi smoke for the pi-multiagent release candidate.",
			authority: { allowFilesystemRead: true },
			steps: [
				{
					id: "child-smoke",
					agent: { system: `Reply exactly ${expectedFinal} and nothing else.` },
					task: `Reply exactly ${expectedFinal} and nothing else.`,
				},
			],
			limits: { timeoutSecondsPerStep: Math.max(30, Math.ceil(timeoutMs / 1000)) },
		},
		options: { terminalRetentionSeconds: 30, notify: { mode: "none" } },
	};
}

function makeOptions(): AgentTeamRuntimeOptions {
	return {
		cwd: packageRoot,
		packageAgentsDir: join(packageRoot, "agents"),
		materializationDiagnostics: [],
		catalogLibrary: { sources: ["package"], query: undefined, projectAgents: "deny" },
		catalogPreparationDiagnostics: [],
		defaults: { model: undefined, thinking: undefined },
		parentTools: parentTools(),
		parentSkills: parentSkills(),
		signal: undefined,
		onUpdate: undefined,
	};
}

function parentTools(): ParentToolInventory {
	return { apiAvailable: true, errorMessage: undefined, tools: BUILTIN_CHILD_TOOL_NAMES.map(parentTool) };
}

function parentTool(name: (typeof BUILTIN_CHILD_TOOL_NAMES)[number]): ParentToolInfo {
	return { name, description: `${name} tool`, active: true, sourceInfo: { path: `<builtin:${name}>`, source: "builtin", scope: "temporary", origin: "top-level", baseDir: undefined } };
}

function parentSkills(): ParentSkillInventory {
	return { apiAvailable: true, readActive: true, errorMessage: undefined, skills: [] };
}
