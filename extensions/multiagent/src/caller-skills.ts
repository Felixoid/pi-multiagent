/** Explicit caller-visible Pi skill selection for isolated subagents. */

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	AgentDiagnostic,
	ParentSkillInfo,
	ParentSkillInventory,
	ResolvedCallerSkill,
	ResolvedCallerSkillSource,
} from "./types.ts";
import { MAX_CALLER_SKILLS, SKILL_NAME_PATTERN } from "./types.ts";
import { findNearestWorkspaceRoot, isContainedPath } from "./project-root.ts";

const SKILL_NAME_REGEX = new RegExp(SKILL_NAME_PATTERN);
const MAX_SKILL_HASH_BYTES = 4 * 1024 * 1024;
const EMPTY_PARENT_SKILLS: ParentSkillInventory = { apiAvailable: true, readActive: false, errorMessage: undefined, skills: [] };

export interface CallerSkillResolutionContext {
	parentSkills: ParentSkillInventory | undefined;
	sourceCache: Map<string, SkillSourceReadResult>;
	cwdRealpath: string | undefined;
	workspaceRootRealpath: string | undefined;
}

interface NormalizedCallerSkillsSelection {
	mode: "none" | "include";
	names: string[];
	explicit: boolean;
}

type SkillSourceReadResult = { source: ResolvedCallerSkillSource; hidden: boolean; error?: never } | { source?: never; hidden?: never; error: string };

export function getParentSkillInventory(pi: ExtensionAPI): ParentSkillInventory {
	try {
		const activeTools = new Set(pi.getActiveTools());
		if (!activeTools.has("read")) return { apiAvailable: true, readActive: false, errorMessage: undefined, skills: [] };
		const skills: ParentSkillInfo[] = pi.getCommands()
			.filter((command) => command.source === "skill" && command.name.startsWith("skill:"))
			.map((command) => ({
				name: command.name.slice("skill:".length),
				description: command.description,
				sourceInfo: {
					path: command.sourceInfo.path,
					source: command.sourceInfo.source,
					scope: command.sourceInfo.scope,
					origin: command.sourceInfo.origin,
					baseDir: command.sourceInfo.baseDir,
				},
			}))
			.filter((skill) => SKILL_NAME_REGEX.test(skill.name));
		return { apiAvailable: true, readActive: true, errorMessage: undefined, skills };
	} catch (error) {
		return { apiAvailable: false, readActive: false, errorMessage: `Could not read parent Pi skill inventory: ${error instanceof Error ? error.message : String(error)}`, skills: [] };
	}
}

export function createCallerSkillResolutionContext(parentSkills: ParentSkillInventory | undefined, cwd: string): CallerSkillResolutionContext {
	const cwdRealpath = safeRealpath(cwd);
	const workspaceRoot = cwdRealpath ? findWorkspaceRoot(cwdRealpath) : undefined;
	return { parentSkills: parentSkills ?? EMPTY_PARENT_SKILLS, sourceCache: new Map(), cwdRealpath, workspaceRootRealpath: workspaceRoot ? safeRealpath(workspaceRoot) : undefined };
}

export function resolveAgentCallerSkills(input: {
	selection: string[] | undefined;
	tools: string[];
	label: string;
	path: string;
	allowProjectCode: boolean;
	diagnostics: AgentDiagnostic[];
	context: CallerSkillResolutionContext | undefined;
}): ResolvedCallerSkill[] | undefined {
	const selection = normalizeCallerSkillsSelection(input.selection);
	if (selection.mode === "none") return [];
	const invalidNames = selection.names.filter((name) => !SKILL_NAME_REGEX.test(name));
	if (invalidNames.length > 0) {
		input.diagnostics.push({ code: "caller-skills-name-invalid", message: `${input.label} has invalid caller skill names: ${invalidNames.join(", ")}.`, path: input.path, severity: "error" });
		return undefined;
	}
	const duplicate = firstDuplicate(selection.names);
	if (duplicate) {
		input.diagnostics.push({ code: "caller-skills-duplicate", message: `${input.label} selects caller skill ${duplicate} more than once.`, path: input.path, severity: "error" });
		return undefined;
	}
	const parentSkills = input.context?.parentSkills;
	if (parentSkills === undefined || !parentSkills.apiAvailable) {
		if (!selection.explicit) return [];
		input.diagnostics.push({ code: "caller-skills-inventory-unavailable", message: parentSkills?.errorMessage ?? `Cannot resolve selected skills for ${input.label}: parent Pi skill inventory is unavailable.`, path: input.path, severity: "error" });
		return undefined;
	}
	if (!input.tools.includes("read")) {
		if (!selection.explicit) return [];
		input.diagnostics.push({ code: "caller-skills-read-required", message: `${input.label} selects skills, but Pi exposes skill files to subagents only when the filesystem read/discovery suite is granted. Enable graph.authority.allowFilesystemRead or remove agent.skills.`, path: input.path, severity: "error" });
		return undefined;
	}
	if (!parentSkills.readActive) return resolveFromUnavailableCaller(selection, input);
	return resolveVisibleCallerSkills(selection, input, parentSkills);
}

export function verifyResolvedCallerSkillSources(skills: ResolvedCallerSkill[]): string | undefined {
	const checked = new Set<string>();
	for (const skill of skills) {
		if (checked.has(skill.source.realpath)) continue;
		checked.add(skill.source.realpath);
		const current = readCallerSkillSource(skill);
		if ("error" in current) return `Caller skill source changed before launch for ${skill.name}: ${current.error}`;
		if (!sameCallerSkillSourceState(skill.source, current.source)) return `Caller skill source changed before launch for ${skill.name}; refusing to load stale skill instructions.`;
	}
	return undefined;
}

function resolveFromUnavailableCaller(selection: NormalizedCallerSkillsSelection, input: { label: string; path: string; diagnostics: AgentDiagnostic[] }): ResolvedCallerSkill[] | undefined {
	if (selection.mode === "include" && selection.names.length > 0) {
		input.diagnostics.push({ code: "caller-skills-unavailable", message: `${input.label} requests caller skills ${selection.names.join(", ")}, but the calling model has no visible Pi skills because read is not active in the parent.`, path: input.path, severity: "error" });
		return undefined;
	}
	return [];
}

function resolveVisibleCallerSkills(selection: NormalizedCallerSkillsSelection, input: {
	label: string;
	path: string;
	allowProjectCode: boolean;
	diagnostics: AgentDiagnostic[];
	context: CallerSkillResolutionContext | undefined;
}, parentSkills: ParentSkillInventory): ResolvedCallerSkill[] | undefined {
	const parentByName = parentSkillMap(parentSkills, input);
	if (!parentByName || !validateCallerSkillSourcePolicy(selection, parentByName, input)) return undefined;
	const visibleNames = visibleSelectedNames(selection, parentByName, input);
	const missing = selectedMissingNames(selection, visibleNames);
	if (missing.length > 0) {
		input.diagnostics.push({ code: "caller-skills-unknown", message: `${input.label} references caller skills not visible to the calling model: ${missing.join(", ")}.`, path: input.path, severity: "error" });
		return undefined;
	}
	const resolved = selectedSkillNames(selection, visibleNames).map((name) => toResolvedCallerSkill(parentByName.get(name), input)).filter((skill): skill is ResolvedCallerSkill => skill !== undefined);
	if (resolved.length > MAX_CALLER_SKILLS) {
		input.diagnostics.push({ code: "caller-skills-too-many", message: `${input.label} selects ${resolved.length} caller skills; maximum is ${MAX_CALLER_SKILLS}. Use a smaller agent.skills list.`, path: input.path, severity: "error" });
		return undefined;
	}
	return resolved;
}

function parentSkillMap(parentSkills: ParentSkillInventory, input: { path: string; diagnostics: AgentDiagnostic[] }): Map<string, ParentSkillInfo> | undefined {
	const duplicate = firstDuplicate(parentSkills.skills.map((skill) => skill.name));
	if (duplicate) {
		input.diagnostics.push({ code: "caller-skills-ambiguous", message: `Multiple visible parent Pi skills are named ${duplicate}; reload Pi or resolve the skill-name collision before delegation.`, path: input.path, severity: "error" });
		return undefined;
	}
	return new Map(parentSkills.skills.map((skill) => [skill.name, skill]));
}

function validateCallerSkillSourcePolicy(selection: NormalizedCallerSkillsSelection, parentByName: Map<string, ParentSkillInfo>, input: { label: string; path: string; allowProjectCode: boolean; context: CallerSkillResolutionContext | undefined; diagnostics: AgentDiagnostic[] }): boolean {
	let valid = true;
	for (const skill of policyCandidateSkills(selection, parentByName)) {
		const source = readCallerSkillSourceCached(skill, input.context);
		if ("error" in source || source.hidden || input.allowProjectCode || !callerSkillRequiresProjectAuthority(source.source, input.context)) continue;
		input.diagnostics.push({ code: "caller-skills-project-code-authority-required", message: `${input.label} selects caller skill ${skill.name} from ${source.source.scope} scope; set graph.authority.allowProjectCode:true or choose a user-scoped skill.`, path: input.path, severity: "error" });
		valid = false;
	}
	return valid;
}

function policyCandidateSkills(selection: NormalizedCallerSkillsSelection, parentByName: Map<string, ParentSkillInfo>): ParentSkillInfo[] {
	if (selection.mode === "include") return selection.names.map((name) => parentByName.get(name)).filter((skill): skill is ParentSkillInfo => skill !== undefined);
	return [];
}

function callerSkillRequiresProjectAuthority(source: ResolvedCallerSkillSource, context: CallerSkillResolutionContext | undefined): boolean {
	return source.scope === "project" || source.scope === "temporary" || (context?.cwdRealpath !== undefined && isContainedPath(context.cwdRealpath, source.realpath)) || (context?.workspaceRootRealpath !== undefined && isContainedPath(context.workspaceRootRealpath, source.realpath));
}

function visibleSelectedNames(selection: NormalizedCallerSkillsSelection, parentByName: Map<string, ParentSkillInfo>, input: { context: CallerSkillResolutionContext | undefined; diagnostics: AgentDiagnostic[] }): Set<string> {
	const requested = new Set(selection.names);
	const visible = new Set<string>();
	for (const skill of parentByName.values()) {
		if (!requested.has(skill.name)) continue;
		if (callerSkillVisible(skill, input)) visible.add(skill.name);
	}
	return visible;
}

function selectedSkillNames(selection: NormalizedCallerSkillsSelection, visibleNames: Set<string>): string[] {
	if (selection.mode === "include") return selection.names.filter((name) => visibleNames.has(name));
	return [];
}

function selectedMissingNames(selection: NormalizedCallerSkillsSelection, visibleNames: Set<string>): string[] {
	if (selection.mode !== "include") return [];
	return selection.names.filter((name) => !visibleNames.has(name));
}

function callerSkillVisible(skill: ParentSkillInfo | undefined, input: { context: CallerSkillResolutionContext | undefined; diagnostics: AgentDiagnostic[] }): boolean {
	if (!skill) return false;
	const source = readCallerSkillSourceCached(skill, input.context);
	if ("error" in source) {
		input.diagnostics.push({ code: "caller-skill-source-unavailable", message: `Skipping caller skill ${skill.name}: ${source.error}`, path: skill.sourceInfo.path, severity: "warning" });
		return false;
	}
	return !source.hidden;
}

function toResolvedCallerSkill(skill: ParentSkillInfo | undefined, input: { context: CallerSkillResolutionContext | undefined }): ResolvedCallerSkill | undefined {
	if (!skill) return undefined;
	const source = readCallerSkillSourceCached(skill, input.context);
	if ("error" in source || source.hidden) return undefined;
	return { name: skill.name, description: skill.description, source: source.source };
}

function readCallerSkillSourceCached(skill: ParentSkillInfo, context: CallerSkillResolutionContext | undefined): SkillSourceReadResult {
	const key = `${skill.name}\u0000${skill.sourceInfo.path}`;
	const cached = context?.sourceCache.get(key);
	if (cached) return cached;
	const current = readCallerSkillSource(skill);
	context?.sourceCache.set(key, current);
	return current;
}

function readCallerSkillSource(skill: ParentSkillInfo | ResolvedCallerSkill): SkillSourceReadResult {
	const sourceInfo = "sourceInfo" in skill ? skill.sourceInfo : skill.source;
	if (!isAbsolute(sourceInfo.path)) return { error: "skill source path is not absolute" };
	if (!sourceInfo.path.endsWith(".md")) return { error: "skill source path is not a markdown file" };
	try {
		const lexical = lstatSync(sourceInfo.path);
		if (!lexical.isFile() && !lexical.isSymbolicLink()) return { error: "skill source path is not a regular file" };
		const realpath = realpathSync(sourceInfo.path);
		if (!realpath.endsWith(".md")) return { error: "skill source realpath is not a markdown file" };
		const stats = statSync(realpath);
		if (!stats.isFile()) return { error: "skill source realpath is not a regular file" };
		if (stats.size > MAX_SKILL_HASH_BYTES) return { error: `skill source exceeds ${MAX_SKILL_HASH_BYTES} byte fingerprint limit` };
		const content = readFileSync(realpath);
		return {
			hidden: parseDisableModelInvocation(content.toString("utf8")),
			source: {
				path: sourceInfo.path,
				realpath,
				source: sourceInfo.source,
				scope: sourceInfo.scope,
				origin: sourceInfo.origin,
				baseDir: sourceInfo.baseDir,
				dev: stats.dev,
				ino: stats.ino,
				size: stats.size,
				mtimeMs: stats.mtimeMs,
				sha256: createHash("sha256").update(content).digest("hex"),
			},
		};
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function sameCallerSkillSourceState(left: ResolvedCallerSkillSource, right: ResolvedCallerSkillSource): boolean {
	return left.realpath === right.realpath && left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.sha256 === right.sha256;
}

function normalizeCallerSkillsSelection(selection: string[] | undefined): NormalizedCallerSkillsSelection {
	if (selection === undefined) return { mode: "none", names: [], explicit: false };
	return { mode: "include", names: selection, explicit: true };
}

function findWorkspaceRoot(cwd: string): string {
	return findNearestWorkspaceRoot(cwd);
}

function safeRealpath(path: string): string | undefined {
	try {
		return realpathSync(path);
	} catch {
		return undefined;
	}
}

function parseDisableModelInvocation(content: string): boolean {
	const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---")) return false;
	const end = normalized.indexOf("\n---", 3);
	if (end === -1) return false;
	const frontmatter = normalized.slice(4, end);
	for (const line of frontmatter.split("\n")) {
		const index = line.indexOf(":");
		if (index <= 0) continue;
		const key = line.slice(0, index).trim();
		if (key !== "disable-model-invocation") continue;
		return yamlBooleanTrue(line.slice(index + 1));
	}
	return false;
}

function yamlBooleanTrue(value: string): boolean {
	return stripYamlScalarComment(value).trim().replace(/^[\'"]|[\'"]$/g, "").toLowerCase() === "true";
}

function stripYamlScalarComment(value: string): string {
	let quote = "";
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if ((char === "'" || char === '"') && quote === "") quote = char;
		else if (char === quote) quote = "";
		else if (char === "#" && quote === "" && (index === 0 || /\s/.test(value[index - 1] ?? ""))) return value.slice(0, index);
	}
	return value;
}

function firstDuplicate(values: string[]): string | undefined {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) return value;
		seen.add(value);
	}
	return undefined;
}
