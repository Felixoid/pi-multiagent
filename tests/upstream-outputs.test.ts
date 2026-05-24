import assert from "node:assert/strict";
import test from "node:test";
import { collectUpstreamOutputs } from "../extensions/multiagent/src/upstream-outputs.ts";
import { INLINE_HANDOFF_CHARS, INLINE_HANDOFF_PREVIEW_CHARS } from "../extensions/multiagent/src/types.ts";
import type { StepState } from "../extensions/multiagent/src/detached-state.ts";
import type { ResolvedAgent, StepOutput, TeamStepSpec } from "../extensions/multiagent/src/types.ts";

function agent(id: string): ResolvedAgent {
	return { id, ref: `inline:${id}`, name: id, kind: "inline", description: id, tools: ["read", "grep", "find", "ls"], extensionTools: [], callerSkills: [], systemPrompt: "", model: undefined, thinking: undefined, source: "inline", filePath: undefined, sha256: undefined };
}

function spec(id: string, needs: string[] = [], after: string[] = []): TeamStepSpec {
	return { id, agent: agent(id), task: id, needs, after, cwd: "/tmp", cwdIdentity: { realpath: "/tmp", dev: 0, ino: 0 } };
}

function state(id: string, finalText: string, output: StepOutput): StepState {
	return { spec: spec(id), status: output.status, startedAt: "start", endedAt: "end", errorMessage: undefined, output, finalText, assistantFinals: [finalText], liveText: finalText, liveTextEventChars: finalText.length, controller: undefined, promise: undefined };
}

test("oversized upstream output includes bounded preview and artifact pointer", () => {
	const longText = "x".repeat(INLINE_HANDOFF_CHARS + 1);
	const output: StepOutput = { stepId: "big", status: "succeeded", text: longText.slice(0, 100), filePath: "/tmp/big-final.md", chars: longText.length };
	const states = new Map<string, StepState>([["big", state("big", longText, output)]]);
	const upstream = collectUpstreamOutputs(spec("summary", ["big"]), states)[0];
	assert.ok(upstream);
	assert.equal(upstream.text?.startsWith("x".repeat(INLINE_HANDOFF_PREVIEW_CHARS)), true);
	assert.equal(upstream.text?.includes("x".repeat(INLINE_HANDOFF_PREVIEW_CHARS + 1)), false);
	assert.match(upstream.text ?? "", /upstream output truncated before handoff/);
	assert.match(upstream.text ?? "", /Full output artifact: "\/tmp\/big-final\.md"/);
	assert.match(upstream.text ?? "", new RegExp(`full chars=${longText.length}`));
});

test("small upstream output remains fully inline", () => {
	const finalText = "small upstream";
	const output: StepOutput = { stepId: "small", status: "succeeded", text: finalText, filePath: "/tmp/small-final.md", chars: finalText.length };
	const states = new Map<string, StepState>([["small", state("small", finalText, output)]]);
	const upstream = collectUpstreamOutputs(spec("summary", ["small"]), states)[0];
	assert.equal(upstream?.text, finalText);
});

test("many oversized upstream dependencies stay artifact-first under a fan-in ceiling", () => {
	const dependencyIds = Array.from({ length: 12 }, (_value, index) => `dep-${index}`);
	const states = new Map<string, StepState>();
	for (const id of dependencyIds) {
		const finalText = `${id}:` + "x".repeat(INLINE_HANDOFF_CHARS + 1000);
		const output: StepOutput = { stepId: id, status: "succeeded", text: finalText.slice(0, 100), filePath: `/tmp/${id}-final.md`, chars: finalText.length };
		states.set(id, state(id, finalText, output));
	}
	const upstream = collectUpstreamOutputs(spec("summary", dependencyIds), states);
	const totalChars = upstream.reduce((sum, output) => sum + (output.text?.length ?? 0), 0);
	assert.equal(upstream.length, 12);
	assert.equal(totalChars < 32000, true);
	assert.equal(upstream.every((output) => output.text?.includes("Full output artifact") === true), true);
});
