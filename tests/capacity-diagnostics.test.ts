import assert from "node:assert/strict";
import test from "node:test";
import { detachedRunCapacityErrorForSnapshots } from "../extensions/multiagent/src/delegation.ts";
import { MAX_RETAINED_DETACHED_RUNS } from "../extensions/multiagent/src/types.ts";
import type { RunSnapshot, StepStatus } from "../extensions/multiagent/src/types.ts";

test("retained capacity diagnostics include live and terminal buckets", () => {
	const snapshots: RunSnapshot[] = [];
	for (let index = 0; index < MAX_RETAINED_DETACHED_RUNS - 1; index += 1) snapshots.push(snapshot(`r${index + 1}`, true, "succeeded"));
	snapshots.push(snapshot("r64", false, "running"));
	const error = detachedRunCapacityErrorForSnapshots(snapshots);
	assert.equal(error?.code, "detached-run-retained-cap-reached");
	assert.match(error?.message ?? "", /Live runs \(1\): r64:running/);
	assert.match(error?.message ?? "", /Terminal runs \(63\): r1:succeeded/);
});

test("capacity diagnostics do not expose other-session run handles", () => {
	const snapshots: RunSnapshot[] = [];
	for (let index = 0; index < MAX_RETAINED_DETACHED_RUNS - 1; index += 1) snapshots.push(snapshot(`r${index + 1}`, true, "succeeded"));
	snapshots.push(snapshot("r64", false, "running"));
	const error = detachedRunCapacityErrorForSnapshots(snapshots, []);
	assert.equal(error?.code, "detached-run-retained-cap-reached");
	assert.match(error?.message ?? "", /Live runs \(1\): owned: none; other sessions: 1 live/);
	assert.match(error?.message ?? "", /Terminal runs \(63\): owned: none; other sessions: 63 terminal/);
	assert.doesNotMatch(error?.message ?? "", /r64:running|r1:succeeded/);
});

function snapshot(runId: string, terminal: boolean, status: RunSnapshot["status"]): RunSnapshot {
	const counts: Record<StepStatus, number> = { pending: 0, running: terminal ? 0 : 1, succeeded: terminal ? 1 : 0, failed: 0, blocked: 0, timed_out: 0, canceled: 0 };
	return {
		runId,
		objective: "capacity",
		status,
		terminal,
		createdAt: "2026-05-17T00:00:00.000Z",
		updatedAt: "2026-05-17T00:00:00.000Z",
		expiresAt: undefined,
		liveStepIds: terminal ? [] : ["one"],
		sinkStepIds: ["one"],
		lastEvent: undefined,
		canMessage: !terminal,
		canCancel: !terminal,
		canCleanup: terminal,
		counts,
	};
}
