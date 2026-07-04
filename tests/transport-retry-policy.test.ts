import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetryTransportFailure } from "../extensions/multiagent/src/transport-retry-policy.ts";
import type { RpcStepResult } from "../extensions/multiagent/src/rpc-child-types.ts";
import type { ResolvedExtensionToolGrant, ResolvedAgent, StepOutputLimit, TeamStepSpec } from "../extensions/multiagent/src/types.ts";

const outputLimit: StepOutputLimit = { maxBytes: 4 * 1024 * 1024, maxAssistantFinals: 64 };

function step(agentOverrides: Partial<ResolvedAgent> = {}): TeamStepSpec {
	return {
		id: "one",
		agent: {
			id: "one",
			ref: "inline:one",
			name: "one",
			kind: "inline",
			description: "read-only step",
			tools: ["read", "grep", "find", "ls"],
			extensionTools: [],
			callerSkills: [],
			systemPrompt: "Read only.",
			model: undefined,
			thinking: undefined,
			source: "inline",
			filePath: undefined,
			sha256: undefined,
			...agentOverrides,
		},
		task: "Map evidence.",
		needs: [],
		after: [],
		cwd: "/tmp",
		cwdIdentity: { realpath: "/tmp", dev: 1, ino: 1 },
		outputLimit,
	};
}

function result(overrides: Partial<RpcStepResult> = {}): RpcStepResult {
	return {
		status: "failed",
		text: "",
		assistantFinals: [],
		stderr: "",
		errorMessage: "upstream connect error or disconnect/reset before headers. reset reason: connection termination",
		...overrides,
	};
}

function extensionGrant(): ResolvedExtensionToolGrant {
	return {
		name: "exa_search",
		description: "search",
		source: {
			path: "/tmp/ext.js",
			realpath: "/tmp/ext.js",
			source: "/tmp/ext.js",
			scope: "temporary",
			origin: "top-level",
			baseDir: undefined,
			dev: 1,
			ino: 2,
			size: 10,
			mtimeMs: 1,
			sha256: undefined,
		},
	};
}

test("transport retry is limited to the first read-only evidence-free transport failure", () => {
	const readonlyStep = step();
	assert.equal(shouldRetryTransportFailure(readonlyStep, result(), 0), true);
	assert.equal(shouldRetryTransportFailure(readonlyStep, result(), 1), false);
	assert.equal(shouldRetryTransportFailure(readonlyStep, result({ parentMessagesAccepted: true }), 0), false);
	assert.equal(shouldRetryTransportFailure(readonlyStep, result({ assistantFinals: ["done"] }), 0), false);
	assert.equal(shouldRetryTransportFailure(readonlyStep, result({ nonFinalText: "partial evidence" }), 0), false);
	assert.equal(shouldRetryTransportFailure(readonlyStep, result({ text: "partial evidence" }), 0), false);
	assert.equal(shouldRetryTransportFailure(readonlyStep, result({ errorMessage: "assistant-final-empty" }), 0), false);
	assert.equal(shouldRetryTransportFailure(step({ tools: ["read", "grep", "find", "ls", "bash"] }), result(), 0), false);
	assert.equal(shouldRetryTransportFailure(step({ extensionTools: [extensionGrant()] }), result(), 0), false);
});
