import assert from "node:assert/strict";
import test from "node:test";
import { BackgroundEventStore } from "../extensions/multiagent/src/background-events.ts";

test("BackgroundEventStore cursor does not skip events omitted by maxBytes", () => {
	const store = new BackgroundEventStore();
	store.append({ stepId: "one", type: "step", label: "start", preview: "first", status: "running" });
	store.append({ stepId: "one", type: "assistant_delta", label: "text", preview: "x".repeat(2000), status: "running" });
	store.append({ stepId: "one", type: "step", label: "finish", preview: "done", status: "done" });

	const first = store.delta(undefined, undefined, 180);
	assert.equal(first.events.length, 1);
	assert.equal(first.events[0].seq, 1);

	const second = store.delta(first.cursor, undefined, 180);
	assert.equal(second.events.length, 1);
	assert.equal(second.events[0].seq, 2);
});

test("BackgroundEventStore detects only material run_status-wait changes", () => {
	const store = new BackgroundEventStore();
	const cursor = store.currentCursor();
	store.append({ stepId: "one", type: "step", label: "start", preview: "one", status: "running" });
	store.append({ stepId: "one", type: "assistant_delta", label: "text", preview: "draft", status: "running" });
	store.append({ stepId: "one", type: "tool", label: "read", preview: "start", status: "running" });
	store.append({ stepId: "one", type: "tool", label: "read", preview: "done", status: "done" });
	store.append({ stepId: "one", type: "ui", label: "setStatus", preview: "UI request ignored", status: "done" });
	assert.equal(store.hasMaterialAfter(cursor, "one", ["one"]), false);
	store.append({ stepId: "one", type: "step", label: "finish", preview: "done", status: "succeeded" });
	assert.equal(store.hasMaterialAfter(cursor, "one", ["one"]), true);
	assert.equal(store.hasMaterialAfter(cursor, "two", ["one"]), false);
	store.append({ type: "run", label: "terminal", preview: "succeeded", status: "done" });
	assert.equal(store.hasMaterialAfter(cursor, "two", ["one"]), true);
});

test("BackgroundEventStore wakes targeted waits for run-level error diagnostics", () => {
	const store = new BackgroundEventStore();
	const cursor = store.currentCursor();
	store.append({ stepId: "other", type: "assistant_delta", label: "text", preview: "draft", status: "running" });
	assert.equal(store.hasMaterialAfter(cursor, "one", []), false);
	store.append({ type: "diagnostic", label: "run-ui", preview: "callback failed", status: "error" });
	assert.equal(store.hasMaterialAfter(cursor, "one", []), true);
});

test("BackgroundEventStore bounds a first oversized debug event preview", () => {
	const store = new BackgroundEventStore();
	store.append({ stepId: "one", type: "assistant_delta", label: "text", preview: "x".repeat(2000), status: "running" });
	const delta = store.delta(undefined, undefined, 220);
	assert.equal(delta.events.length, 1);
	assert.equal(delta.events[0].seq, 1);
	assert.doesNotMatch(delta.events[0].preview ?? "", new RegExp("x".repeat(500)));
	assert.equal(Buffer.byteLength(JSON.stringify(delta.events[0]), "utf8") <= 220, true);
});
