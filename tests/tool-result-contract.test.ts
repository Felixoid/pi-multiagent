import assert from "node:assert/strict";
import test from "node:test";
import { agentTeamToolResultErrorOverride, registerMultiagentExtension } from "../extensions/multiagent/index.ts";

test("agent_team ok=false tool results override Pi transcript isError", () => {
	assert.deepEqual(agentTeamToolResultErrorOverride({ toolName: "agent_team", details: { kind: "agent_team", ok: false } } as any), { isError: true });
	assert.equal(agentTeamToolResultErrorOverride({ toolName: "agent_team", details: { kind: "agent_team", ok: true } } as any), undefined);
	assert.equal(agentTeamToolResultErrorOverride({ toolName: "read", details: { kind: "agent_team", ok: false } } as any), undefined);
	assert.equal(agentTeamToolResultErrorOverride({ toolName: "agent_team", details: { kind: "other", ok: false } } as any), undefined);
});

test("extension registers the agent_team tool_result error override", () => {
	const handlers = new Map<string, (event: unknown) => unknown>();
	registerMultiagentExtension({
		on(event: string, handler: (event: unknown) => unknown) {
			handlers.set(event, handler);
		},
		registerMessageRenderer() {},
		registerFlag() {},
		registerTool() {},
		sendMessage() {},
		getThinkingLevel() {
			return undefined;
		},
	} as any);
	const handler = handlers.get("tool_result");
	assert.equal(typeof handler, "function");
	assert.deepEqual(handler?.({ toolName: "agent_team", details: { kind: "agent_team", ok: false } }), { isError: true });
	assert.equal(handler?.({ toolName: "agent_team", details: { kind: "agent_team", ok: true } }), undefined);
});
