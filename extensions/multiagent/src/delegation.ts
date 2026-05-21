/** Public detached agent_team action dispatcher. */

import { randomBytes } from "node:crypto";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Compile } from "typebox/compile";
import { catalogAgents, discoverAgents, normalizeLibraryOptions } from "./agents.ts";
import { DetachedRun } from "./detached-run.ts";
import { forgetDetachedRun, getDetachedRun, listDetachedRuns, registerDetachedRun } from "./detached-registry.ts";
import { materializeAgentTeamInput } from "./graph-file.ts";
import { resolveDetachedGraph, validatePreflightShape } from "./planning.ts";
import { finalizeDetails, hasDiagnosticError, makeDetails, type AgentTeamRuntimeOptions, unavailableTools } from "./runtime-options.ts";
import { catalogParentExtensionToolDiagnostics } from "./tool-policy.ts";
import { AgentTeamSchema, type AgentTeamInput, type GraphSpec } from "./schemas.ts";
import type { AgentDiagnostic, AgentTeamDetails, RunSnapshot } from "./types.ts";
import { AGENT_TEAM_ACTION_VALUES, BUILTIN_CHILD_TOOL_NAMES, DEFAULT_GRAPH_LIBRARY_SOURCES, DEFAULT_RESULT_PREVIEW_MAX_BYTES, MAX_LIVE_DETACHED_RUNS, MAX_RETAINED_DETACHED_RUNS, type ExecutionAction } from "./types.ts";

const validateAgentTeamInput = Compile(AgentTeamSchema);
const BUILTIN_CHILD_TOOL_SET = new Set<string>(BUILTIN_CHILD_TOOL_NAMES);

export async function runAgentTeam(rawInput: unknown, options: AgentTeamRuntimeOptions): Promise<AgentToolResult<AgentTeamDetails>> {
	const rawPreflightDiagnostics = validatePreflightShape(rawInput);
	const rawSchemaDiagnostics = validateInputSchema(rawInput);
	const rawDiagnostics = [...rawPreflightDiagnostics, ...rawSchemaDiagnostics];
	const materialized = hasDiagnosticError(rawDiagnostics) ? { input: rawInput, diagnostics: [] } : materializeAgentTeamInput(rawInput, options.cwd);
	const inputForValidation = materialized.input;
	const materializedPreflightDiagnostics = materialized.input === rawInput ? [] : validatePreflightShape(inputForValidation);
	const materializedSchemaDiagnostics = materialized.input === rawInput ? [] : validateInputSchema(inputForValidation);
	const diagnostics = [...options.materializationDiagnostics, ...options.catalogPreparationDiagnostics, ...rawDiagnostics, ...materialized.diagnostics, ...materializedPreflightDiagnostics, ...materializedSchemaDiagnostics];
	if (hasDiagnosticError(diagnostics)) return finalizeDetails(makeDetails(detailsAction(inputForValidation), false, diagnostics, options));
	const input = inputForValidation as AgentTeamInput;
	if (input.action === "catalog") return finalizeDetails(catalog(input, options, diagnostics));
	if (input.action === "start") return finalizeDetails(start(input, options, diagnostics));
	if (input.action === "run_status") return finalizeDetails(await run_status(input, options, diagnostics));
	if (input.action === "step_result") return finalizeDetails(step_result(input, options, diagnostics));
	if (input.action === "message") return finalizeDetails(await message(input, options, diagnostics));
	if (input.action === "cancel") return finalizeDetails(cancel(input, options, diagnostics));
	if (input.action === "cleanup") return finalizeDetails(cleanup(input, options, diagnostics));
	return finalizeDetails(makeDetails("missing/invalid", false, diagnostics, options, undefined, { code: "action-invalid", message: "Unknown action." }));
}

function catalog(input: AgentTeamInput, options: AgentTeamRuntimeOptions, diagnostics: AgentDiagnostic[]): AgentTeamDetails {
	const discovery = discoverAgents({ cwd: options.cwd, packageAgentsDir: options.packageAgentsDir, library: options.catalogLibrary });
	const allDiagnostics = [...diagnostics, ...discovery.diagnostics, ...catalogParentExtensionToolDiagnostics(options.parentTools)];
	return makeDetails("catalog", !hasDiagnosticError(allDiagnostics), allDiagnostics, options, { library: { ...options.catalogLibrary, sources: discovery.sources }, catalog: catalogAgents(discovery, options.catalogLibrary.query) });
}

function start(input: AgentTeamInput, options: AgentTeamRuntimeOptions, diagnostics: AgentDiagnostic[]): AgentTeamDetails {
	if (options.signal?.aborted) return makeDetails("start", false, diagnostics, options, undefined, { code: "start-aborted-before-run-id", message: "Start was aborted before a runId was registered; no child process was launched." });
	const graph = input.graph as GraphSpec | undefined;
	if (!graph) return makeDetails("start", false, diagnostics, options, undefined, { code: "start-graph-missing", message: "Start requires graph or graphFile." });
	const librarySources = graph.library?.sources && graph.library.sources.length > 0 ? graph.library.sources : DEFAULT_GRAPH_LIBRARY_SOURCES;
	const library = normalizeLibraryOptions({ sources: librarySources, projectAgents: graph.authority?.allowProjectCode ? "allow" : "deny" });
	const discovery = discoverAgents({ cwd: options.cwd, packageAgentsDir: options.packageAgentsDir, library });
	const resolved = resolveDetachedGraph(graph, discovery.agents, [...diagnostics, ...discovery.diagnostics], { cwd: options.cwd, invocationCwd: options.cwd, parentTools: options.parentTools ?? unavailableTools(), parentSkills: options.parentSkills, subagentSkillMode: options.subagentSkills?.mode }, input.options);
	if (resolved.steps.length !== graph.steps.length || hasDiagnosticError(resolved.diagnostics)) return makeDetails("start", false, resolved.diagnostics, options, { library: { ...library, sources: discovery.sources } }, { code: "start-planning-failed", message: "Detached graph planning failed; no child process was launched." });
	const capacityError = detachedRunCapacityError();
	if (capacityError) return makeDetails("start", false, resolved.diagnostics, options, { library: { ...library, sources: discovery.sources } }, capacityError);
	const run = new DetachedRun(createRunId(), resolved, detachedRunOptions(options), { ...library, sources: discovery.sources });
	registerDetachedRun(run);
	run.start();
	return run.details("start");
}

async function run_status(input: AgentTeamInput, options: AgentTeamRuntimeOptions, diagnostics: AgentDiagnostic[]): Promise<AgentTeamDetails> {
	const run = getDetachedRun(input.runId);
	if (!run) return makeDetails("run_status", false, diagnostics, options, undefined, runNotFoundError());
	if (input.stepId && !run.hasStep(input.stepId)) return run.details("run_status", { stepId: input.stepId, maxBytes: input.maxBytes ?? DEFAULT_RESULT_PREVIEW_MAX_BYTES, preview: input.preview === true, ok: false, error: { code: "step-not-found", message: "No step in the retained detached run matches stepId." } });
	if (input.waitSeconds !== undefined) await run.waitForChange({ stepId: input.stepId, cursor: input.cursor, seconds: input.waitSeconds });
	return run.details("run_status", { cursor: input.cursor, stepId: input.stepId, maxBytes: input.maxBytes ?? DEFAULT_RESULT_PREVIEW_MAX_BYTES, preview: input.preview === true, includeEvents: input.debugEvents === true });
}

function step_result(input: AgentTeamInput, options: AgentTeamRuntimeOptions, diagnostics: AgentDiagnostic[]): AgentTeamDetails {
	const run = getDetachedRun(input.runId);
	if (!run) return makeDetails("step_result", false, diagnostics, options, undefined, runNotFoundError());
	if (!input.stepId || !run.hasStep(input.stepId)) return run.details("step_result", { stepId: input.stepId, maxBytes: input.maxBytes ?? DEFAULT_RESULT_PREVIEW_MAX_BYTES, preview: input.preview === true, ok: false, error: { code: "step-not-found", message: "No step in the retained detached run matches stepId." } });
	return run.details("step_result", { stepId: input.stepId, maxBytes: input.maxBytes ?? DEFAULT_RESULT_PREVIEW_MAX_BYTES, preview: input.preview === true });
}

async function message(input: AgentTeamInput, options: AgentTeamRuntimeOptions, diagnostics: AgentDiagnostic[]): Promise<AgentTeamDetails> {
	const run = getDetachedRun(input.runId);
	if (!run) return makeDetails("message", false, diagnostics, options, undefined, runNotFoundError());
	const receipt = await run.message(input.stepId ?? "", input.channel ?? "steer", input.text ?? "", input.clientMessageId);
	return run.details("message", { message: receipt, ok: receipt.accepted, error: receipt.accepted ? undefined : { code: "message-not-delivered", message: receipt.undeliveredReason ?? "Message was not delivered." } });
}

function cancel(input: AgentTeamInput, options: AgentTeamRuntimeOptions, diagnostics: AgentDiagnostic[]): AgentTeamDetails {
	const run = getDetachedRun(input.runId);
	if (!run) return makeDetails("cancel", false, diagnostics, options, undefined, runNotFoundError());
	run.cancel(input.reason);
	return run.details("cancel");
}

function cleanup(input: AgentTeamInput, options: AgentTeamRuntimeOptions, diagnostics: AgentDiagnostic[]): AgentTeamDetails {
	const run = getDetachedRun(input.runId);
	if (!run) return makeDetails("cleanup", false, diagnostics, options, undefined, runNotFoundError());
	if (!run.snapshot().terminal) return run.details("cleanup", { ok: false, error: { code: "cleanup-run-live", message: "Cleanup is denied while the run is live; let healthy work finish, or cancel only when stopping is explicit, then run_status terminal state first." } });
	try {
		const receipt = run.cleanup();
		forgetDetachedRun(run.id);
		return makeDetails("cleanup", true, diagnostics, options, { cleanup: receipt });
	} catch (error) {
		return run.details("cleanup", { ok: false, error: { code: "cleanup-artifacts-failed", message: `Cleanup failed while deleting retained artifacts: ${error instanceof Error ? error.message : String(error)}` } });
	}
}

function runNotFoundError(): { code: string; message: string } {
	const runs = listDetachedRuns().map((run) => run.snapshot());
	const recent = summarizeRunCapacity(runs);
	return { code: "run-not-found", message: `No retained detached run matches runId. Run ids are process/session-local and can disappear after retention expiry, cleanup, extension reload, or session shutdown; preserve artifact paths before cleanup. Retained runs now: ${runs.length}; recent: ${recent}.` };
}

function detachedRunCapacityError(): { code: string; message: string } | undefined {
	return detachedRunCapacityErrorForSnapshots(listDetachedRuns().map((run) => run.snapshot()));
}

export function detachedRunCapacityErrorForSnapshots(snapshots: RunSnapshot[]): { code: string; message: string } | undefined {
	const liveRuns = snapshots.filter((run) => !run.terminal);
	const terminalRuns = snapshots.filter((run) => run.terminal);
	if (liveRuns.length >= MAX_LIVE_DETACHED_RUNS) return { code: "detached-run-live-cap-reached", message: `Too many live detached runs (${liveRuns.length}); run_status and preserve evidence, then cancel only runs that are stuck, obsolete, unsafe, or explicitly lower value than the new work. Maximum live runs: ${MAX_LIVE_DETACHED_RUNS}. Live runs: ${summarizeRunCapacity(liveRuns)}.` };
	if (snapshots.length >= MAX_RETAINED_DETACHED_RUNS) return { code: "detached-run-retained-cap-reached", message: `Too many retained detached runs (${snapshots.length}); free capacity by cleaning up terminal runs only after preserving needed artifacts, or by canceling live runs only when they are stuck, obsolete, unsafe, or explicitly lower value than the new work. Maximum retained runs: ${MAX_RETAINED_DETACHED_RUNS}. Live runs (${liveRuns.length}): ${summarizeRunCapacity(liveRuns)}. Terminal runs (${terminalRuns.length}): ${summarizeRunCapacity(terminalRuns)}.` };
	return undefined;
}

function summarizeRunCapacity(runs: RunSnapshot[]): string {
	const rows = runs.slice(0, 5).map((run) => `${run.runId}:${run.status}`).join(", ");
	if (runs.length === 0) return "none";
	return runs.length > 5 ? `${rows}, +${runs.length - 5} more` : rows;
}

function detachedRunOptions(options: AgentTeamRuntimeOptions): AgentTeamRuntimeOptions {
	return { ...options, onUpdate: undefined };
}

function validateInputSchema(input: unknown): AgentDiagnostic[] {
	if (validateAgentTeamInput.Check(input)) return [];
	const first = [...validateAgentTeamInput.Errors(input)][0];
	const path = first?.instancePath || "/";
	const message = first ? `agent_team input schema violation at ${path}: ${first.message}` : "agent_team input does not match the public schema; check action-specific fields, enum values, bounds, and unknown properties.";
	return [{ code: "input-schema-invalid", message, path, severity: "error", repair: schemaRepair(input, path) }];
}

function schemaRepair(input: unknown, path: string): string {
	if (isRecord(input)) {
		const misplacedExtensionTool = findMisplacedExtensionToolName(input);
		if (misplacedExtensionTool) return `agent.tools accepts only built-in child tools (${BUILTIN_CHILD_TOOL_NAMES.join(", ")}). Move extension tool ${misplacedExtensionTool} to steps[].agent.extensionTools with catalog-copied {name, from:{source, scope?, origin?}} provenance and set graph.authority.allowExtensionCode:true; do not put extension tool names in agent.tools.`;
		if (findAgentSkillsField(input)) return "Remove steps[].agent.skills. Subagent skill availability is controlled only by the product config flag --agent-team-subagent-skills enabled|disabled; it is all-or-nothing, defaults to enabled, and is not graph-controlled.";
		if (input.authority !== undefined) return 'Move authority under graph: {"action":"start","graph":{"authority":{"allowFilesystemRead":true},"objective":"...","steps":[...]}}.';
		if (path === "/maxBytes" || input.maxBytes !== undefined) return "maxBytes must be between 1 and 200000 and is valid only on run_status/step_result: it bounds assistant previews when preview:true and raw debug event previews when run_status debugEvents:true; catalog narrowing uses library.query.";
		if (path === "/preview" || input.preview !== undefined) return "preview must be true or false and is valid only for run_status and step_result; previews default to false.";
		if (path === "/debugEvents" || input.debugEvents !== undefined) return "debugEvents must be true or false and is valid only for run_status; use maxBytes there only to bound raw debug event previews.";
		if (path === "/channel" || input.channel !== undefined) return 'Use channel:"steer" or channel:"follow_up" for message.';
		if (path === "/text" || input.text !== undefined) return "Message text must be a non-empty string.";
	}
	return "Use the action-specific control set: catalog uses library; start uses graph/graphFile plus options; run_status/step_result use runId and preview controls; message uses runId, stepId, channel, text, and optional clientMessageId.";
}

function findMisplacedExtensionToolName(input: Record<string, unknown>): string | undefined {
	const graph = input.graph;
	if (!isRecord(graph) || !Array.isArray(graph.steps)) return undefined;
	for (const step of graph.steps) {
		if (!isRecord(step) || !isRecord(step.agent) || !Array.isArray(step.agent.tools)) continue;
		for (const tool of step.agent.tools) if (typeof tool === "string" && !BUILTIN_CHILD_TOOL_SET.has(tool)) return tool;
	}
	return undefined;
}

function findAgentSkillsField(input: Record<string, unknown>): boolean {
	const graph = input.graph;
	if (!isRecord(graph) || !Array.isArray(graph.steps)) return false;
	return graph.steps.some((step) => isRecord(step) && isRecord(step.agent) && step.agent.skills !== undefined);
}

function detailsAction(input: unknown): ExecutionAction | "missing/invalid" {
	if (!isRecord(input) || typeof input.action !== "string") return "missing/invalid";
	if (AGENT_TEAM_ACTION_VALUES.includes(input.action as ExecutionAction)) return input.action as ExecutionAction;
	return "missing/invalid";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function createRunId(): string {
	return `agt_${randomBytes(32).toString("base64url")}`;
}
