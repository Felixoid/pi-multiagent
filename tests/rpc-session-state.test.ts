import assert from "node:assert/strict";
import test from "node:test";
import { ParentMessageObservability } from "../extensions/multiagent/src/rpc-session-state.ts";

test("parent message queue observations track duplicate message occurrences", () => {
	const tracker = new ParentMessageObservability();
	tracker.accepted("steer", "same text");
	tracker.accepted("steer", "same text");
	let observations = tracker.queueUpdate({ steering: ["same text"], followUp: [] });
	assert.equal(observations.filter((event) => event.label === "steer_queued").length, 1);
	observations = tracker.queueUpdate({ steering: ["same text"], followUp: [] });
	assert.deepEqual(observations, []);
	observations = tracker.queueUpdate({ steering: ["same text", "same text"], followUp: [] });
	assert.equal(observations.filter((event) => event.label === "steer_queued").length, 1);
	observations = tracker.queueUpdate({ steering: ["same text"], followUp: [] });
	assert.equal(observations.filter((event) => event.label === "steer_consumed").length, 1);
	observations = tracker.terminalNoRetry();
	assert.equal(observations.filter((event) => event.label === "steer_no_next_turn").length, 1);
});

test("parent message terminal observations distinguish no-next-turn from unproven consumption", () => {
	const queued = new ParentMessageObservability();
	queued.accepted("follow_up", "queued follow-up");
	assert.equal(queued.queueUpdate({ steering: [], followUp: ["queued follow-up"] }).some((event) => event.label === "follow_up_queued"), true);
	assert.equal(queued.terminalNoRetry().some((event) => event.label === "follow_up_no_next_turn"), true);

	const unproven = new ParentMessageObservability();
	unproven.accepted("follow_up", "unobserved follow-up");
	const observations = unproven.terminalNoRetry();
	assert.equal(observations.some((event) => event.label === "follow_up_consumption_unproven"), true);
	assert.equal(observations.some((event) => event.label === "follow_up_no_next_turn"), false);
});
