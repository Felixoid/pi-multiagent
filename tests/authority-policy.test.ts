import assert from "node:assert/strict";
import test from "node:test";
import { builtinToolAuthority, builtinToolAllowedByAuthority, BUILTIN_TOOL_AUTHORITY_MATRIX, extensionToolPolicyFromAuthority, GRAPH_AUTHORITY_KEYS, normalizeAuthority } from "../extensions/multiagent/src/authority-policy.ts";
import { MUTATION_CHILD_TOOL_NAMES, READONLY_CHILD_TOOL_NAMES, SHELL_CHILD_TOOL_NAMES, type GraphAuthority } from "../extensions/multiagent/src/types.ts";

const falseAuthority: GraphAuthority = {
	allowFilesystemRead: false,
	allowShellTools: false,
	allowMutationTools: false,
	allowExtensionCode: false,
	allowProjectCode: false,
};

const trueAuthority: GraphAuthority = {
	allowFilesystemRead: true,
	allowShellTools: true,
	allowMutationTools: true,
	allowExtensionCode: true,
	allowProjectCode: true,
};

test("authority matrix covers the graph authority contract exactly", () => {
	const expected: (keyof GraphAuthority)[] = ["allowFilesystemRead", "allowShellTools", "allowMutationTools", "allowExtensionCode", "allowProjectCode"];
	assert.deepEqual([...GRAPH_AUTHORITY_KEYS].sort(), expected.sort());
	assert.deepEqual(normalizeAuthority(undefined), falseAuthority);
	assert.deepEqual(normalizeAuthority({ allowFilesystemRead: true, allowProjectCode: true }), { ...falseAuthority, allowFilesystemRead: true, allowProjectCode: true });
});

test("built-in child tools map to the documented authority classes", () => {
	assert.deepEqual(BUILTIN_TOOL_AUTHORITY_MATRIX.map((row) => row.kind), ["filesystem-read", "shell", "mutation"]);
	for (const tool of READONLY_CHILD_TOOL_NAMES) {
		assert.equal(builtinToolAuthority(tool), "allowFilesystemRead");
		assert.equal(builtinToolAllowedByAuthority(tool, falseAuthority), false);
		assert.equal(builtinToolAllowedByAuthority(tool, { ...falseAuthority, allowFilesystemRead: true }), true);
	}
	for (const tool of SHELL_CHILD_TOOL_NAMES) {
		assert.equal(builtinToolAuthority(tool), "allowShellTools");
		assert.equal(builtinToolAllowedByAuthority(tool, falseAuthority), false);
		assert.equal(builtinToolAllowedByAuthority(tool, { ...falseAuthority, allowShellTools: true }), true);
	}
	for (const tool of MUTATION_CHILD_TOOL_NAMES) {
		assert.equal(builtinToolAuthority(tool), "allowMutationTools");
		assert.equal(builtinToolAllowedByAuthority(tool, falseAuthority), false);
		assert.equal(builtinToolAllowedByAuthority(tool, { ...falseAuthority, allowMutationTools: true }), true);
	}
});

test("extension tool trust policy is deny or allow derived from project-code authority", () => {
	assert.deepEqual(extensionToolPolicyFromAuthority(falseAuthority), { projectExtensions: "deny", localExtensions: "deny" });
	assert.deepEqual(extensionToolPolicyFromAuthority(trueAuthority), { projectExtensions: "allow", localExtensions: "allow" });
	const policyValues: string[] = [extensionToolPolicyFromAuthority(falseAuthority).projectExtensions, extensionToolPolicyFromAuthority(trueAuthority).projectExtensions];
	assert.equal(policyValues.includes("confirm"), false);
});
