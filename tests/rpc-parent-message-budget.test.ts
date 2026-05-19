import assert from "node:assert/strict";
import test from "node:test";
import { ParentMessageBudget } from "../extensions/multiagent/src/rpc-parent-message-budget.ts";
import { MAX_PARENT_MESSAGE_CHARS_PER_STEP, MAX_PARENT_MESSAGES_PER_STEP } from "../extensions/multiagent/src/types.ts";

test("ParentMessageBudget denies the first attempt beyond the per-step attempt budget", () => {
	const budget = new ParentMessageBudget();
	for (let attempt = 0; attempt < MAX_PARENT_MESSAGES_PER_STEP; attempt += 1) assert.equal(budget.reserve("x"), undefined);
	assert.match(budget.reserve("x") ?? "", new RegExp(`attempts=${MAX_PARENT_MESSAGES_PER_STEP}/${MAX_PARENT_MESSAGES_PER_STEP}`));
});

test("ParentMessageBudget denies char overflow without consuming a later valid attempt", () => {
	const budget = new ParentMessageBudget();
	assert.match(budget.reserve("x".repeat(MAX_PARENT_MESSAGE_CHARS_PER_STEP + 1)) ?? "", new RegExp(`chars=${MAX_PARENT_MESSAGE_CHARS_PER_STEP + 1}/${MAX_PARENT_MESSAGE_CHARS_PER_STEP}`));
	assert.equal(budget.reserve("ok"), undefined);
});
