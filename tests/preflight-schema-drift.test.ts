/** Preflight repairs name only current graph-body controls; schema owns unknown-field denial. */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Compile } from "typebox/compile";
import { validatePreflightShape } from "../extensions/multiagent/src/preflight-shape.ts";
import { AgentTeamSchema } from "../extensions/multiagent/src/schemas.ts";

const validate = Compile(AgentTeamSchema);
const startGraphRepair = 'Move graph body fields under graph: {"action":"start","graph":{"objective":"...","authority":{"allowFilesystemRead":true},"steps":[...]}}. Put start sources in graph.library; top-level library is catalog-only.';

test("start repair copy lists supported graph controls only", () => {
	const diagnostics = validatePreflightShape({
		action: "start",
		objective: "x",
		steps: [{ id: "a", agent: { system: "s" }, task: "t" }],
		agents: [{ id: "unsupported" }],
		synthesis: { task: "unsupported" },
		outputContract: "unsupported",
		callerSkills: ["unsupported"],
	});
	const denied = diagnostics.find((d) => d.code === "start-control-fields-denied");
	assert.ok(denied, "top-level objective/steps should produce start-control-fields-denied");
	assert.deepEqual(denied.fields, ["objective", "steps"]);
	assert.equal(denied.repair, startGraphRepair);
});

test("top-level objective still gets the current graph-body repair", () => {
	const diagnostics = validatePreflightShape({
		action: "start",
		objective: "x",
	});
	const start = diagnostics.find((d) => d.code === "start-control-fields-denied");
	assert.ok(start, "objective at top-level should produce start-control-fields-denied");
	assert.ok(start.fields?.includes("objective"));
	assert.equal(start.repair, startGraphRepair);
});

test("top-level extensionTools gets the dedicated step-agent repair", () => {
	const diagnostics = validatePreflightShape({
		action: "start",
		extensionTools: [],
		graph: {
			objective: "o",
			steps: [{ id: "a", agent: { system: "s" }, task: "t" }],
		},
	});
	const denied = diagnostics.find((d) => d.code === "start-control-fields-denied" && d.fields?.includes("extensionTools"));
	assert.ok(denied, "extensionTools at top-level should be flagged misplaced");
	assert.ok(denied.repair?.includes("Place extensionTools under steps[].agent.extensionTools"));
});

test("schema rejects unsupported graph-body fields", () => {
	const invalid = {
		action: "start",
		graph: {
			objective: "o",
			steps: [{ id: "a", agent: { system: "s" }, task: "t" }],
			agents: [{ id: "unsupported" }],
			synthesis: { task: "unsupported" },
			outputContract: "unsupported",
			callerSkills: ["unsupported"],
		},
	};
	assert.equal(validate.Check(invalid), false);
});

test("schema rejects unknown graph-body fields even when preflight has no repair", () => {
	const invalid = {
		objective: "o",
		steps: [{ id: "a", agent: { system: "s" }, task: "t" }],
		outputContract: "anything",
	};
	const wrapped = { action: "start", graph: invalid };
	assert.equal(validate.Check(wrapped), false);
});
