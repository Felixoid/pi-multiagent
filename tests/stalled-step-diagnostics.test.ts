import assert from "node:assert/strict";
import test from "node:test";
import { stalledStepBlockerMessage } from "../extensions/multiagent/src/stalled-step-diagnostics.ts";
import type { StepStatus } from "../extensions/multiagent/src/types.ts";

test("stalledStepBlockerMessage names needs and after blockers", () => {
	const statuses = new Map<string, StepStatus>([
		["map", "failed"],
		["review", "pending"],
		["audit", "running"],
	]);
	const message = stalledStepBlockerMessage({ id: "reduce", needs: ["map", "missing-need"], after: ["review", "audit"] }, (id) => statuses.get(id) ?? "missing");
	assert.match(message, /No runnable steps remain for reduce/);
	assert.match(message, /needs waiting: map=failed, missing-need=missing/);
	assert.match(message, /after waiting: review=pending, audit=running/);
});

test("stalledStepBlockerMessage includes dependency-cycle hint when no blockers are visible", () => {
	const message = stalledStepBlockerMessage({ id: "orphan", needs: [], after: [] }, () => "succeeded");
	assert.match(message, /dependency-cycle hint/);
});
