import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { catalogParentExtensionToolDiagnostics, catalogParentExtensionTools, resolveAgentToolAccess } from "../extensions/multiagent/src/tool-policy.ts";
import type { AgentDiagnostic, ExtensionSourceOrigin, ExtensionSourceScope, ParentToolInfo, ParentToolInventory } from "../extensions/multiagent/src/types.ts";

function tool(name: string, source: string, active = true, input?: { path?: string; scope?: ExtensionSourceScope; origin?: ExtensionSourceOrigin; baseDir?: string }): ParentToolInfo {
	return {
		name,
		description: `${name} tool`,
		active,
		sourceInfo: {
			path: input?.path ?? `/tmp/${name}.ts`,
			source,
			scope: input?.scope ?? "user",
			origin: input?.origin ?? "package",
			baseDir: input?.baseDir ?? "/tmp",
		},
	};
}

function inventory(tools: ParentToolInfo[]): ParentToolInventory {
	return { apiAvailable: true, errorMessage: undefined, tools };
}

test("catalog extension tools omit ambiguous or unloadable parent tools with diagnostics", () => {
	const parent = inventory([
		tool("exa_search", "user:one"),
		tool("exa_search", "user:two"),
		tool("sdk_tool", "sdk"),
		tool("agent_team", "user:multiagent"),
		tool("inactive_tool", "user:inactive", false),
		tool("exa_fetch", "user:exa"),
	]);
	assert.deepEqual(catalogParentExtensionTools(parent).map((item) => item.name), ["exa_fetch"]);
	const codes = catalogParentExtensionToolDiagnostics(parent).map((item) => item.code);
	assert.equal(codes.includes("extension-tool-active-ambiguous"), true);
	assert.equal(codes.includes("extension-tool-sdk-unloadable"), true);
});

test("extension grant resolution denies reserved and duplicate active tool names", () => {
	const diagnostics: AgentDiagnostic[] = [];
	const duplicate = resolveAgentToolAccess({
		tools: ["read"],
		extensionTools: [{ name: "exa_search", from: { source: "user:one" } }],
		label: "step agent one",
		toolsPath: "/agent/tools",
		extensionToolsPath: "/agent/extensionTools",
		diagnostics,
		context: { parentTools: inventory([tool("exa_search", "user:one"), tool("exa_search", "user:two")]), extensionToolPolicy: { projectExtensions: "deny", localExtensions: "deny" }, cwd: "/tmp" },
	});
	assert.equal(duplicate, undefined);
	assert.equal(diagnostics.some((item) => item.code === "extension-tool-active-ambiguous"), true);

	const reservedDiagnostics: AgentDiagnostic[] = [];
	const reserved = resolveAgentToolAccess({
		tools: ["read"],
		extensionTools: [{ name: "agent_team", from: { source: "user:multiagent" } }],
		label: "step agent two",
		toolsPath: "/agent/tools",
		extensionToolsPath: "/agent/extensionTools",
		diagnostics: reservedDiagnostics,
		context: { parentTools: inventory([tool("agent_team", "user:multiagent")]), extensionToolPolicy: { projectExtensions: "deny", localExtensions: "deny" }, cwd: "/tmp" },
	});
	assert.equal(reserved, undefined);
	assert.equal(reservedDiagnostics.some((item) => item.code === "extension-tool-reserved"), true);
});

test("extension grant resolution denies project and workspace-local sources without confirm branch", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-tool-policy-"));
	const workspace = join(root, "workspace");
	await writeFile(join(root, "project-extension.ts"), "export default function extension() {}\n");
	await writeFile(join(root, "local-extension.ts"), "export default function extension() {}\n");
	const projectTool = tool("project_search", "project:search", true, { path: join(root, "project-extension.ts"), scope: "project", origin: "top-level", baseDir: root });
	const localTool = tool("local_search", "user:local", true, { path: join(root, "local-extension.ts"), scope: "temporary", origin: "top-level", baseDir: root });

	const projectDiagnostics: AgentDiagnostic[] = [];
	const projectDenied = resolveAgentToolAccess({
		tools: ["read"],
		extensionTools: [{ name: "project_search", from: { source: "project:search", scope: "project", origin: "top-level" } }],
		label: "step agent project",
		toolsPath: "/agent/tools",
		extensionToolsPath: "/agent/extensionTools",
		diagnostics: projectDiagnostics,
		context: { parentTools: inventory([projectTool]), extensionToolPolicy: { projectExtensions: "deny", localExtensions: "deny" }, cwd: workspace },
	});
	assert.equal(projectDenied, undefined);
	assert.equal(projectDiagnostics.some((item) => item.code === "extension-tool-project-denied"), true);
	assert.equal(projectDiagnostics.some((item) => item.message.includes("allowProjectCode:true")), true);
	assert.equal(projectDiagnostics.some((item) => item.code.includes("confirm")), false);

	const localDiagnostics: AgentDiagnostic[] = [];
	const localDenied = resolveAgentToolAccess({
		tools: ["read"],
		extensionTools: [{ name: "local_search", from: { source: "user:local", scope: "temporary", origin: "top-level" } }],
		label: "step agent local",
		toolsPath: "/agent/tools",
		extensionToolsPath: "/agent/extensionTools",
		diagnostics: localDiagnostics,
		context: { parentTools: inventory([localTool]), extensionToolPolicy: { projectExtensions: "deny", localExtensions: "deny" }, cwd: workspace },
	});
	assert.equal(localDenied, undefined);
	assert.equal(localDiagnostics.some((item) => item.code === "extension-tool-local-denied"), true);
	assert.equal(localDiagnostics.some((item) => item.message.includes("allowProjectCode:true")), true);
	assert.equal(localDiagnostics.some((item) => item.code.includes("confirm")), false);

	const catalog = catalogParentExtensionTools(inventory([projectTool, localTool]), workspace);
	assert.equal(catalog.find((item) => item.name === "project_search")?.requiresProjectCode, true);
	assert.equal(catalog.find((item) => item.name === "local_search")?.requiresProjectCode, true);

	const allowedDiagnostics: AgentDiagnostic[] = [];
	const allowed = resolveAgentToolAccess({
		tools: ["read"],
		extensionTools: [{ name: "project_search", from: { source: "project:search", scope: "project", origin: "top-level" } }],
		label: "step agent allowed",
		toolsPath: "/agent/tools",
		extensionToolsPath: "/agent/extensionTools",
		diagnostics: allowedDiagnostics,
		context: { parentTools: inventory([projectTool]), extensionToolPolicy: { projectExtensions: "allow", localExtensions: "allow" }, cwd: workspace },
	});
	assert.equal(allowedDiagnostics.some((item) => item.severity === "error"), false);
	assert.equal(allowed?.extensionTools[0]?.name, "project_search");
});
