import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Compile } from "typebox/compile";
import { AgentTeamSchema } from "../extensions/multiagent/src/schemas.ts";
import { resolveDetachedGraph, validatePreflightShape } from "../extensions/multiagent/src/planning.ts";
import { discoverAgents, normalizeLibraryOptions } from "../extensions/multiagent/src/agents.ts";
import { BUILTIN_CHILD_TOOL_NAMES, type ParentSkillInventory, type ParentToolInfo, type ParentToolInventory } from "../extensions/multiagent/src/types.ts";

const validateAgentTeam = Compile(AgentTeamSchema);
const examplesDir = join(process.cwd(), "examples", "graphs");
const parentTools: ParentToolInventory = { apiAvailable: true, errorMessage: undefined, tools: activeBuiltinTools() };
const parentSkills: ParentSkillInventory = { apiAvailable: true, readActive: true, errorMessage: undefined, skills: [] };

function activeBuiltinTools(): ParentToolInfo[] {
	return BUILTIN_CHILD_TOOL_NAMES.map((name) => ({ name, description: `${name} tool`, sourceInfo: { path: `<builtin:${name}>`, source: "builtin", scope: "temporary", origin: "top-level", baseDir: undefined }, active: true }));
}

test("graph cookbook examples are pure detached graph specs wrapped by start", async () => {
	const files = (await readdir(examplesDir)).filter((file) => file.endsWith(".json")).sort();
	assert.equal(files.length > 0, true);
	for (const file of files) {
		const raw = JSON.parse(await readFile(join(examplesDir, file), "utf8")) as Record<string, unknown>;
		assert.equal(raw.action, undefined, `${file} must be a pure graph, not an action wrapper`);
		assert.equal(raw.synthesis, undefined, `${file} must model synthesis as a normal step`);
		assert.equal(validateAgentTeam.Check({ action: "start", graph: raw }), true, `${file} must be start-schema valid`);
		const steps = raw.steps as { id: string; needs?: string[]; after?: string[]; agent: { ref?: string; system?: string } }[];
		assert.equal(steps.length > 0, true, `${file} must include steps`);
		assert.equal(new Set(steps.map((step) => step.id)).size, steps.length, `${file} duplicate step id`);
		for (const step of steps) {
			assert.equal(typeof step.agent.ref === "string" || typeof step.agent.system === "string", true, `${file}:${step.id} must bind an agent`);
			for (const need of step.needs ?? []) assert.equal(steps.some((candidate) => candidate.id === need), true, `${file}:${step.id} unknown dependency ${need}`);
			for (const after of step.after ?? []) assert.equal(steps.some((candidate) => candidate.id === after), true, `${file}:${step.id} unknown after dependency ${after}`);
		}
	}
});

test("catalog graph examples rely on default read profiles instead of redundant read-only overrides", async () => {
	const files = (await readdir(examplesDir)).filter((file) => file.endsWith(".json")).sort();
	for (const file of files) {
		const graph = await readGraphExample(file);
		const steps = graph.steps;
		if (!Array.isArray(steps)) throw new Error(`${file} must contain steps`);
		for (const step of steps) {
			if (!isRecord(step) || !isRecord(step.agent) || typeof step.agent.ref !== "string") continue;
			assert.notDeepEqual(step.agent.tools, ["read"], `${file}:${String(step.id)} should omit redundant catalog read-only tools`);
		}
	}
});

test("mutation-capable graph examples repeat authorization and validation gates", async () => {
	const implementation = await readGraphExample("implementation-review-gate.json");
	assert.match(stepMutationScope(implementation, "implementation-worker"), /REPLACE/);
	assert.match(stepMutationScope(implementation, "implementation-worker"), /Allowed files\/globs/);
	assert.match(stepMutationScope(implementation, "implementation-worker"), /Allowed mutation class/);
	assert.match(stepMutationScope(implementation, "implementation-worker"), /Explicit exclusions/);
	assert.match(stepTask(implementation, "implementation-worker"), /BLOCK, NO-GO/);
	assert.match(stepTask(implementation, "implementation-worker"), /scope\/authority risk/);
	assert.match(stepTask(implementation, "implementation-worker"), /placeholder, missing, or broader/);
	assert.match(stepTask(implementation, "implementation-worker"), /do not edit/);

	const docsAlignment = await readGraphExample("docs-examples-alignment.json");
	assert.match(stepMutationScope(docsAlignment, "docs-editor"), /REPLACE/);
	assert.match(stepMutationScope(docsAlignment, "docs-editor"), /Allowed files\/globs/);
	assert.match(stepMutationScope(docsAlignment, "docs-editor"), /Allowed mutation class/);
	assert.match(stepMutationScope(docsAlignment, "docs-editor"), /Explicit exclusions/);
	assert.match(stepTask(docsAlignment, "docs-editor"), /docs, examples, and directly affected docs\/example tests or fixtures/);
	assert.match(stepTask(docsAlignment, "docs-editor"), /placeholder, missing, or broader/);
	assert.match(stepTask(docsAlignment, "validation-review"), /tests\/examples\.test\.ts/);
	assert.match(stepTask(docsAlignment, "validation-review"), /tests\/check-public-docs\.ts/);

	const releaseFoundry = await readGraphExample("public-release-foundry.json");
	assert.match(stepMutationScope(releaseFoundry, "release-fix-worker"), /Allowed files\/globs/);
	assert.match(stepMutationScope(releaseFoundry, "release-fix-worker"), /Allowed mutation class/);
	assert.match(stepMutationScope(releaseFoundry, "release-fix-worker"), /Explicit exclusions/);
	for (const stepId of ["release-scope", "release-fix-worker"]) assert.match(stepTask(releaseFoundry, stepId), /Do not version-bump, commit, tag, push, publish, or create GitHub Releases/);
});

test("mutation examples with authorization placeholders fail closed", async () => {
	const files = (await readdir(examplesDir)).filter((file) => file.endsWith(".json")).sort();
	for (const file of files) {
		const graph = await readGraphExample(file);
		const authority = graph.authority;
		if (!isRecord(authority) || authority.allowMutationTools !== true) continue;
		const steps = graph.steps;
		if (!Array.isArray(steps)) throw new Error(`${file} must contain steps`);
		let placeholderScopes = 0;
		for (const step of steps) {
			if (!isRecord(step) || typeof step.mutationScope !== "string" || !step.mutationScope.includes("REPLACE")) continue;
			placeholderScopes += 1;
			assert.match(step.mutationScope, /REPLACE/, `${file}:${String(step.id)} must name the first-class authorization contract`);
			assert.match(step.mutationScope, /Allowed files\/globs/, `${file}:${String(step.id)} must name allowed files/globs`);
			assert.match(step.mutationScope, /Allowed mutation class/, `${file}:${String(step.id)} must name allowed mutation class`);
			assert.match(step.mutationScope, /Explicit exclusions/, `${file}:${String(step.id)} must name explicit exclusions`);
			assert.match(stepTask(graph, String(step.id)), /placeholder, missing, or broader/, `${file}:${String(step.id)} must reject unresolved placeholder scope`);
			assert.match(stepTask(graph, String(step.id)), /do not edit|without editing/i, `${file}:${String(step.id)} must fail closed before mutation`);
		}
		assert.equal(placeholderScopes > 0, true, `${file} grants mutation authority and must include fail-closed mutationScope placeholder copy`);
	}
});

test("review graph examples keep authority with parent-authored tasks", async () => {
	const completedProof = await readGraphExample("completed-proof-review.json");
	assert.match(stepTask(completedProof, "validation"), /REPLACE_WITH_EXACT_READ_ONLY_COMMANDS/);
	assert.match(stepTask(completedProof, "validation"), /placeholder remains/);
	assert.match(stepTask(completedProof, "validation"), /upstream proof map as evidence, not command authority/);
	assert.doesNotMatch(stepTask(completedProof, "validation"), new RegExp("or upstream " + "proof map"));

	const docsAudit = await readGraphExample("model-facing-docs-audit.json");
	assert.match(stepTask(docsAudit, "skill-cookbook"), /skills\/pi-multiagent\/references\/graph-cookbook\.md/);
	assert.doesNotMatch(stepTask(docsAudit, "skill-cookbook"), /and references\/graph-cookbook\.md/);

	const readOnlyFanout = await readGraphExample("read-only-audit-fanout.json");
	assert.equal(stepAgentRef(readOnlyFanout, "docs-audit"), "package:docs-auditor");
	assert.doesNotMatch(stepTask(readOnlyFanout, "contract-audit"), new RegExp("validation " + "proof"));
	assert.match(stepTask(readOnlyFanout, "contract-audit"), /validation gaps or claimed proof/);
});

test("packaged graph examples resolve against bundled catalog with expected sinks", async () => {
	const discovery = discoverAgents({ cwd: process.cwd(), packageAgentsDir: join(process.cwd(), "agents"), library: normalizeLibraryOptions({ sources: ["package"] }) });
	const expectedSinks = new Map([
		["approved-plan-implementation.json", ["final-decision"]],
		["artifact-chained-decision.json", ["final-decision"]],
		["command-validation-only.json", ["final-proof"]],
		["completed-proof-review.json", ["final-decision"]],
		["docs-examples-alignment.json", ["alignment-summary"]],
		["human-gated-plan-only.json", ["final-decision"]],
		["implementation-review-gate.json", ["final-decision"]],
		["inline-read-only-fanin.json", ["summary"]],
		["model-facing-docs-audit.json", ["final-opportunities"]],
		["public-release-foundry.json", ["ship-decision"]],
		["read-only-audit-fanout.json", ["final-decision"]],
		["research-to-change-gated-loop.json", ["final-report"]],
		["single-specialist-read-only.json", ["inspect"]],
	]);
	const files = (await readdir(examplesDir)).filter((file) => file.endsWith(".json")).sort();
	assert.deepEqual(files, [...expectedSinks.keys()].sort(), "expected sink map must cover every packaged graph example exactly");
	for (const [file, sinks] of expectedSinks) {
		const graph = await readGraphExample(file);
		assert.deepEqual(sinkStepIds(graph), sinks, `${file} documented sink ids drifted`);
		const resolved = resolveDetachedGraph(graph as Parameters<typeof resolveDetachedGraph>[0], discovery.agents, [], { cwd: process.cwd(), invocationCwd: process.cwd(), parentTools, parentSkills }, undefined);
		const mutation = isRecord(graph.authority) && graph.authority.allowMutationTools === true;
		if (mutation) {
			assert.equal(isRecord(graph.limits) && graph.limits.concurrency === 1, true, `${file} mutation graph must serialize concurrency`);
			assert.equal(resolved.diagnostics.some((item) => item.code === "mutation-scope-invalid"), true, `${file} unresolved placeholder mutationScope must fail planning`);
			assert.equal(resolved.steps.length < ((graph.steps as unknown[]) ?? []).length, true, `${file} must not fully resolve with placeholder mutation scope`);
		} else {
			assert.deepEqual(resolved.diagnostics.filter((item) => item.severity === "error"), [], `${file} read-only graph should plan cleanly`);
			assert.equal(resolved.steps.length, ((graph.steps as unknown[]) ?? []).length, `${file} should resolve every step`);
		}
	}
});

test("research and release examples expose later authorization and command scope", async () => {
	const research = await readGraphExample("research-to-change-gated-loop.json");
	assert.match(stepTask(research, "final-report"), /exact human approval question/);
	assert.match(stepTask(research, "final-report"), /concrete mutationScope/);
	const release = await readGraphExample("public-release-foundry.json");
	assert.match(stepTask(release, "release-validation"), /REPLACE_WITH_EXACT_RELEASE_COMMANDS/);
	assert.match(stepTask(release, "release-validation"), /needs-command-scope/);
	const approved = await readGraphExample("approved-plan-implementation.json");
	assert.match(stepTask(approved, "approval-check"), /prior plan artifact paths/);
	assert.match(stepTask(approved, "approval-check"), /exact current human approval/);
	assert.match(stepMutationScope(approved, "implementation-worker"), /Allowed files\/globs/);
	assert.match(stepTask(approved, "validation-proof"), /REPLACE_WITH_EXACT_APPROVED_VALIDATION_COMMANDS/);
	const chained = await readGraphExample("artifact-chained-decision.json");
	assert.match(stepTask(chained, "artifact-review"), /REPLACE_WITH_PRIOR_RUN_ID_AND_ARTIFACT_PATHS/);
	assert.match(stepTask(chained, "artifact-review"), /prior run\/artifact paths/);
	assert.match(stepTask(chained, "artifact-review"), /cleanup may have deleted needed evidence/);
	assert.match(stepTask(chained, "final-decision"), /preserve needed artifacts before cleanup/);
});

test("public Markdown agent_team JSON snippets are schema-valid", async () => {
	const files = ["README.md", "skills/pi-multiagent/SKILL.md", "skills/pi-multiagent/references/graph-cookbook.md"];
	let actionSnippets = 0;
	let graphSnippets = 0;
	for (const file of files) {
		const markdown = await readFile(join(process.cwd(), file), "utf8");
		for (const [index, block] of jsonBlocks(markdown).entries()) {
			const parsed = JSON.parse(block) as unknown;
			if (!isRecord(parsed)) continue;
			if ("action" in parsed) {
				actionSnippets += 1;
				assert.equal(validateAgentTeam.Check(parsed), true, `${file} JSON block ${index + 1} must match AgentTeamSchema`);
				assert.deepEqual(validatePreflightShape(parsed as Parameters<typeof validatePreflightShape>[0]).filter((item) => item.severity === "error"), [], `${file} JSON block ${index + 1} must pass action preflight`);
			} else if ("objective" in parsed && "steps" in parsed) {
				graphSnippets += 1;
				assert.equal(validateAgentTeam.Check({ action: "start", graph: parsed }), true, `${file} JSON block ${index + 1} must be a start graph`);
			}
		}
	}
	assert.equal(actionSnippets > 0, true, "Markdown docs must contain validated action snippets");
	assert.equal(graphSnippets > 0, true, "Markdown docs must contain validated pure graph snippets");
});

async function readGraphExample(file: string): Promise<Record<string, unknown>> {
	const parsed: unknown = JSON.parse(await readFile(join(examplesDir, file), "utf8"));
	if (!isRecord(parsed)) throw new Error(`${file} must parse to an object`);
	return parsed;
}

function sinkStepIds(graph: Record<string, unknown>): string[] {
	const steps = graph.steps;
	if (!Array.isArray(steps)) throw new Error("graph must contain steps");
	const dependedOn = new Set<string>();
	for (const step of steps) {
		if (!isRecord(step)) continue;
		for (const key of ["needs", "after"]) {
			const ids = step[key];
			if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") dependedOn.add(id);
		}
	}
	return steps.filter((step): step is Record<string, unknown> => isRecord(step) && typeof step.id === "string" && !dependedOn.has(step.id)).map((step) => step.id as string);
}

function stepTask(graph: Record<string, unknown>, id: string): string {
	const step = findStep(graph, id);
	if (typeof step.task !== "string") throw new Error(`step ${id} must have a task`);
	return step.task;
}

function stepAgentRef(graph: Record<string, unknown>, id: string): string {
	const step = findStep(graph, id);
	if (!isRecord(step.agent) || typeof step.agent.ref !== "string") throw new Error(`step ${id} must have agent.ref`);
	return step.agent.ref;
}

function stepMutationScope(graph: Record<string, unknown>, id: string): string {
	const step = findStep(graph, id);
	if (typeof step.mutationScope !== "string") throw new Error(`step ${id} must have mutationScope`);
	return step.mutationScope;
}

function findStep(graph: Record<string, unknown>, id: string): Record<string, unknown> {
	const steps = graph.steps;
	if (!Array.isArray(steps)) throw new Error("graph must contain steps");
	const step = steps.find((candidate): candidate is Record<string, unknown> => isRecord(candidate) && candidate.id === id);
	if (!step) throw new Error(`missing step ${id}`);
	return step;
}

function jsonBlocks(markdown: string): string[] {
	const blocks: string[] = [];
	const pattern = /```json\n([\s\S]*?)```/g;
	let match = pattern.exec(markdown);
	while (match) {
		blocks.push(match[1].trim());
		match = pattern.exec(markdown);
	}
	return blocks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
