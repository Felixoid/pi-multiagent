import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_MAX_RUN_SECONDS,
	DEFAULT_NOTIFY_MAX_NOTICES,
	DEFAULT_NOTIFY_MIN_INTERVAL_SECONDS,
	DEFAULT_NOTIFY_MODE,
	DEFAULT_TERMINAL_RETENTION_SECONDS,
	DEFAULT_TIMEOUT_SECONDS_PER_STEP,
	MAX_AGENT_FILE_BYTES,
	MAX_CONCURRENCY,
	MAX_DEPENDENCIES_PER_STEP,
	MAX_EVENTS_PER_RUN,
	MAX_GRAPH_FILE_BYTES,
	MAX_LIVE_DETACHED_RUNS,
	MAX_MAX_RUN_SECONDS,
	MAX_NOTIFY_MAX_NOTICES,
	MAX_NOTIFY_MIN_INTERVAL_SECONDS,
	MAX_ASSISTANT_FINAL_MESSAGES_PER_STEP,
	MAX_PARENT_MESSAGE_CHARS_PER_STEP,
	MAX_PARENT_MESSAGES_PER_STEP,
	MAX_RETAINED_DETACHED_RUNS,
	MAX_STEP_OUTPUT_BYTES,
	MAX_RETRIEVE_WAIT_SECONDS,
	MAX_STEPS,
	MAX_TERMINAL_RETENTION_SECONDS,
	MAX_TIMEOUT_SECONDS_PER_STEP,
	RPC_RECORD_MAX_CHARS,
} from "../extensions/multiagent/src/types.ts";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const version = readPackageVersion();
const publicFiles = [
	"package.json",
	"README.md",
	"CHANGELOG.md",
	...collectFiles("agents", ".md"),
	...collectFiles("examples", ".json"),
	...collectFiles("skills", ".md"),
	...collectFiles("extensions", ".ts"),
];
const failures: string[] = [];

for (const file of publicFiles) {
	const text = readFileSync(join(packageRoot, file), "utf8");
	checkPortableText(file, text);
	if (file.endsWith(".md")) checkMarkdownLinks(file, text);
}

checkPinnedGithubTags();
checkCatalogIsAuthoritative();
checkDetachedContractCopy();
checkActionSnippetHygiene();
checkTimeoutContract();
checkLimitsContract();
checkGraphExamples();
checkNoRootStaleNotes();
checkPackageGalleryMetadata();
checkReleaseHandoffContract();

assert.equal(failures.length, 0, `Public package portability checks failed:\n${failures.join("\n")}`);

function readPackageVersion(): string {
	const parsed: unknown = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	if (!isObject(parsed) || typeof parsed.version !== "string") throw new Error("package.json must contain a string version");
	return parsed.version;
}

function isObject(value: unknown): value is { [key: string]: unknown } {
	return typeof value === "object" && value !== null;
}

function collectFiles(directory: string, extension: string): string[] {
	const root = join(packageRoot, directory);
	const results: string[] = [];
	collectFilesInto(root, extension, results);
	return results.sort();
}

function collectFilesInto(directory: string, extension: string, results: string[]): void {
	for (const entry of readdirSync(directory)) {
		const fullPath = join(directory, entry);
		const stats = statSync(fullPath);
		if (stats.isDirectory()) collectFilesInto(fullPath, extension, results);
		else if (stats.isFile() && fullPath.endsWith(extension)) results.push(relative(packageRoot, fullPath).split(sep).join("/"));
	}
}

function checkPortableText(file: string, text: string): void {
	for (const fragment of ["/" + "Users/", "/opt/" + "homebrew", "Code/" + "pi-multiagent", packageRoot, "is" + "Latest"]) {
		if (fragment.length > 0 && text.includes(fragment)) failures.push(`${file}: public package copy must not include machine-local or unsupported fragment ${JSON.stringify(fragment)}`);
	}
}

function checkMarkdownLinks(file: string, text: string): void {
	const linkPattern = /\[[^\]\n]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
	for (const match of text.matchAll(linkPattern)) {
		const rawTarget = match[1];
		if (rawTarget.startsWith("http://") || rawTarget.startsWith("https://") || rawTarget.startsWith("mailto:") || rawTarget.startsWith("#")) continue;
		const withoutAnchor = rawTarget.split("#", 1)[0];
		if (withoutAnchor.length === 0) continue;
		const targetPath = resolve(packageRoot, dirname(file), withoutAnchor);
		if (!existsSync(targetPath)) failures.push(`${file}: Markdown link target does not exist: ${rawTarget}`);
	}
}

function checkPinnedGithubTags(): void {
	const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
	const tagPattern = /github\.com\/Tiziano-AI\/pi-multiagent@v([0-9]+\.[0-9]+\.[0-9]+)/g;
	for (const match of readme.matchAll(tagPattern)) if (match[1] !== version) failures.push(`README.md: pinned GitHub install tag v${match[1]} does not match package version v${version}`);
}

function checkCatalogIsAuthoritative(): void {
	for (const file of ["README.md", "skills/pi-multiagent/SKILL.md"]) {
		const text = readFileSync(join(packageRoot, file), "utf8");
		if (!text.includes("authoritative") || !text.includes("catalog")) failures.push(`${file}: must state catalog output is authoritative`);
		if (!text.includes("routing tags")) failures.push(`${file}: must state catalog output includes routing tags`);
		if (!text.includes("default built-in tool profiles")) failures.push(`${file}: must state catalog output includes default built-in tool profiles`);
		if (text.includes("| Ref | Best use | Default tools |") || text.includes("| Ref | Use for | Default tools |")) failures.push(`${file}: must not duplicate runtime catalog metadata tables`);
	}
}

function checkDetachedContractCopy(): void {
	const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
	const skill = readFileSync(join(packageRoot, "skills/pi-multiagent/SKILL.md"), "utf8");
	const cookbook = readFileSync(join(packageRoot, "skills/pi-multiagent/references/graph-cookbook.md"), "utf8");
	requireFragments("README.md", readme, ["catalog", "start", "retrieve", "peek", "message", "cancel", "cleanup", "`start` returns a usable registered `runId`", "evidence, not instructions", "not an OS sandbox", "not transactional", "not crash-resumable", "not a runtime template API", "RPC mode", "Child internals are not auto-injected", "pushed notices", "sink finals", "preview:true", "mandatory read/discovery", "assistant final in chronological order", "debugEvents:true", "allowFilesystemRead", "allowShellTools", "allowMutationTools", "allowExtensionCode", "allowProjectCode", "Start graphs default to `graph.library.sources:[\"package\"]`", "workspace-local caller skill", "Pushed notices omit child-authored final text", "routing tags", "defaultTools", "All-inline starter", "lastActivity", "Extension grants load trusted code", "Detached runs do not inherit caller-visible skills by default", "Catalog defaults remove boilerplate", "Catalog queries match exact phrases or non-stopword query terms", "Required controls", "waitSeconds", "bounded wait/read", "complete canonical agent-facing reference", "progressive-disclosure hub", "graph design ladder", "artifact-chained-decision.json", "Web Research to Local Decision", "copying exact active catalog provenance", "maxNotices", "process-local", "session shutdown", "Use `needs`", "Use `after`", "graph authority alone is not edit authorization", "Any read/discovery primitive", "Built-ins are launched by child Pi with `--tools`", "retrieve` is the compact manager read path", "peek` is the microscope", "cannot broaden scope, grant tools, authorize mutation", "serious graph", "debugEvents:true` only for package debugging", "preserve terminal artifacts", "cleanup is appropriate", "requires manual cancellation", "never reaches its sink final", "NEEDS-WORK rather than GO", "catalog-default-tools-denied", "package:web-researcher", "Tool profile quick matrix"]);
	requireFragments("skills/pi-multiagent/SKILL.md", skill, ["Action controls are strict", "returns a compact bounded wait/read snapshot", "retrieve", "peek", "message", "cleanup", "waitSeconds", "bounded wait/read", "preview:true", "mandatory read/discovery", "assistant final in chronological order", "debugEvents:true", "catalog profile capped by graph authority", "routing tags", "Catalog queries match exact phrases or non-stopword query terms", "graph authority alone is not edit authorization", "Start graphs default to `graph.library.sources:[\"package\"]`", "workspace-local caller skill", "Pushed notices omit child-authored final text", "maxNotices", "process-local", "session shutdown", "use `needs`", "`after`", "All-inline fan-in starter", "lastActivity", "Detached runs do not inherit caller skills by default", "Any read/discovery primitive", "Built-in child tools are launched by child Pi with `--tools`", "cannot broaden scope, grant tools, authorize mutation", "Action branch resolver", "Graph design ladder", "Artifact-Chained Decision", "Web Research to Local Decision", "complete canonical agent-facing package entrypoint", "progressive-disclosure hub", "Improving this package", "serious graph", "debugEvents:true` only for package debugging", "terminal sink final", "Preserve artifacts before cleanup", "manual cancellation", "missing sink final", "NEEDS-WORK, not GO", "catalog-default-tools-denied", "package:web-researcher", "Tool profile decision matrix"]);
	requireFragments("skills/pi-multiagent/references/graph-cookbook.md", cookbook, ["detached", "not a runtime template API", "Choose a graph shape first", "Graph design ladder", "Single specialist", "Artifact-Chained Decision", "artifact-chained-decision.json", "Web Research to Local Decision", "copy exact active catalog provenance", "allowExtensionCode:true", "trusted workspace content", "graphFile", "routing tags", "default built-in tool profiles", "Catalog queries match exact phrases or non-stopword query terms", "maxNotices", "Use `needs`", "Use `after`", "compact evidence fields", "Parallelize only independent read-only lanes", "Any read/discovery primitive", "mandatory read/discovery", "preview:true", "Inline Read-Only Fan-in", "peek", "sink", "cannot broaden scope, grant tools, authorize mutation", "Web Research Extension Lane", "Read-Only Audit Fanout", "Docs/Examples Alignment", "Implementation Review Gate", "Public Release Foundry", "waitSeconds", "bounded wait/read", "debugEvents:true` only for package debugging", "preserve terminal artifacts", "cleanup is appropriate", "serious graph to reach its sink final without manual cancellation", "stalled, canceled, or final-less", "NEEDS-WORK, not GO", "catalog-default-tools-denied", "package:web-researcher", "Tool profile quick matrix"]);
	requireFragments("README.md", readme, ["explicit `tools` replaces", "StepOutput.filePath", "artifact index", "mutation-authority examples", "source/provenance notes", "Schema-admissible fatal shape failures render as `# agent_team error`", "schema-invalid calls", "library.query", "does not prove the child obeyed", "mutationScope", "Do not demand a premature final"]);
	requireFragments("skills/pi-multiagent/SKILL.md", skill, ["explicit `agent.tools` replaces", "StepOutput.filePath", "artifact indexes", "mutation-authority examples", "source/provenance notes", "Schema-admissible fatal action-shape failures render as `# agent_team error`", "options.maxRunSeconds", "options.terminalRetentionSeconds", "library.query", "does not prove child compliance", "mutationScope", "Do not stop early merely because"]);
	requireFragments("skills/pi-multiagent/references/graph-cookbook.md", cookbook, ["Explicit `agent.tools` replaces", "tools:[\"read\",\"bash\"]", "mutation-authority examples", "source/provenance notes", "Web content cannot broaden", "mutationScope", "Accepted messages prove queueing"]);
	for (const file of ["README.md", "skills/pi-multiagent/SKILL.md", "skills/pi-multiagent/references/graph-cookbook.md"]) {
		const text = readFileSync(join(packageRoot, file), "utf8");
		for (const excluded of ["allowSideEffectTools", "requested built-in child tools must also be active as parent built-in tools", "Catalog-declared tools are metadata only", "Catalog no-tool role", "No built-in tools by default", "Inline agents default to no built-in tools", "Intentional no built-ins", "retired", "compatibility alias", "foreground `run`", "foreground/blocking", "old in-memory"]) if (text.includes(excluded)) failures.push(`${file}: must keep public docs declarative and avoid backward-looking contract copy ${JSON.stringify(excluded)}`);
	}
	for (const file of ["README.md", "CHANGELOG.md", "skills/pi-multiagent/SKILL.md", "skills/pi-multiagent/references/graph-cookbook.md"]) {
		const text = readFileSync(join(packageRoot, file), "utf8");
		if (text.includes("cookbook are the model-facing") || text.includes("this skill/cookbook agent-facing") || text.includes("Keep README, cookbook, and examples human/operator-facing")) failures.push(`${file}: must keep README human/operator-facing and skill plus linked references agent-facing without collapsing the surfaces`);
		if (text.includes('"action": "run"')) failures.push(`${file}: must not document non-contract action:"run"`);
		if (text.includes('"synthesis"')) failures.push(`${file}: must not document non-contract top-level synthesis branch`);
		if (text.includes('"outputContract"')) failures.push(`${file}: must not document non-contract outputContract field`);
		if (text.includes("retrieve/peek-style")) failures.push(`${file}: must not blur retrieve-only and peek controls`);
		if (text.includes("Authorized mutation " + "scope:")) failures.push(`${file}: must use first-class mutationScope instead of task-string mutation authorization`);
	}
}

function checkActionSnippetHygiene(): void {
	for (const file of ["README.md", "skills/pi-multiagent/references/graph-cookbook.md"]) {
		const text = readFileSync(join(packageRoot, file), "utf8");
		if (text.includes('"cursor": "0"')) failures.push(`${file}: routine retrieve snippets must not include cursor:"0"; cursor is for prior retrieve/debug backfill`);
	}
}

function checkTimeoutContract(): void {
	const checkedFiles = ["README.md", ...collectFiles("examples", ".json"), ...collectFiles("skills", ".md")];
	const requiredDefaultCopy = `defaults to ${DEFAULT_TIMEOUT_SECONDS_PER_STEP} seconds`;
	const explicitTimeoutPattern = /"timeoutSecondsPerStep"\s*:\s*([0-9]+)/g;
	for (const file of checkedFiles) {
		const text = readFileSync(join(packageRoot, file), "utf8");
		if (["README.md", "skills/pi-multiagent/SKILL.md", "skills/pi-multiagent/references/graph-cookbook.md"].includes(file) && !text.includes(requiredDefaultCopy)) failures.push(`${file}: must state timeoutSecondsPerStep ${requiredDefaultCopy}`);
		for (const match of text.matchAll(explicitTimeoutPattern)) {
			const seconds = Number(match[1]);
			if (seconds < DEFAULT_TIMEOUT_SECONDS_PER_STEP) failures.push(`${file}:${lineNumberAt(text, match.index)} timeoutSecondsPerStep ${seconds} is below the ${DEFAULT_TIMEOUT_SECONDS_PER_STEP}-second default`);
		}
	}
}

function checkLimitsContract(): void {
	const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
	const fragments = [
		`| Steps | ${MAX_STEPS} |`,
		`| Dependencies per step | ${MAX_DEPENDENCIES_PER_STEP} |`,
		`| Concurrency | 1 to ${MAX_CONCURRENCY}; default ${MAX_CONCURRENCY} |`,
		`1 to ${MAX_TIMEOUT_SECONDS_PER_STEP} seconds; \`timeoutSecondsPerStep\` defaults to ${DEFAULT_TIMEOUT_SECONDS_PER_STEP} seconds`,
		`1 to ${MAX_MAX_RUN_SECONDS} seconds; default ${DEFAULT_MAX_RUN_SECONDS} seconds`,
		`1 to ${MAX_TERMINAL_RETENTION_SECONDS} seconds; default ${DEFAULT_TERMINAL_RETENTION_SECONDS} seconds`,
		`\`waitSeconds\` max ${MAX_RETRIEVE_WAIT_SECONDS} seconds`,
		`| Live detached runs | ${MAX_LIVE_DETACHED_RUNS} per extension process |`,
		`| Retained terminal runs | ${MAX_RETAINED_DETACHED_RUNS} per extension process |`,
		`default \`${DEFAULT_NOTIFY_MODE}\`; max ${MAX_NOTIFY_MAX_NOTICES} non-terminal notices; default ${DEFAULT_NOTIFY_MAX_NOTICES}; minimum interval default ${DEFAULT_NOTIFY_MIN_INTERVAL_SECONDS} seconds, max ${MAX_NOTIFY_MIN_INTERVAL_SECONDS}`,
		`Relative \`.json\` file inside cwd; ${MAX_GRAPH_FILE_BYTES / 1024} KiB max`,
		`| Agent file input | ${MAX_AGENT_FILE_BYTES / 1024} KiB per library agent Markdown file |`,
		`| Retained events per run | ${MAX_EVENTS_PER_RUN} |`,
		`| Parent message budget per live step | ${MAX_PARENT_MESSAGES_PER_STEP} message attempts or ${MAX_PARENT_MESSAGE_CHARS_PER_STEP} sent message chars |`,
		`| Retained assistant output per step | ${MAX_STEP_OUTPUT_BYTES} bytes across non-empty assistant finals; max ${MAX_ASSISTANT_FINAL_MESSAGES_PER_STEP} non-empty assistant finals |`,
		`| RPC JSONL record parse cap | ${RPC_RECORD_MAX_CHARS / 1024 / 1024} MiB |`,
	];
	for (const fragment of fragments) if (!readme.includes(fragment)) failures.push(`README.md: missing runtime limit copy ${JSON.stringify(fragment)}`);
	if (/maxBytes.*200000|200000.*maxBytes/.test(readme)) failures.push("README.md: maxBytes numeric bounds should stay out of the public limits table; preview artifacts stay artifact-first.");
}

function checkGraphExamples(): void {
	for (const file of collectFiles("examples", ".json")) {
		const parsed: unknown = JSON.parse(readFileSync(join(packageRoot, file), "utf8"));
		if (!isObject(parsed)) {
			failures.push(`${file}: graph example must be a JSON object`);
			continue;
		}
		for (const denied of ["action", "agents", "synthesis", "outputContract", "runId", "graphFile"]) if (parsed[denied] !== undefined) failures.push(`${file}: graph example must be pure detached graph; remove ${denied}`);
		if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) failures.push(`${file}: graph example must include steps`);
	}
	const graphFilePackagePathPattern = /"graphFile"\s*:\s*"examples\/graphs\//;
	for (const file of ["README.md", "skills/pi-multiagent/references/graph-cookbook.md"]) {
		const text = readFileSync(join(packageRoot, file), "utf8");
		if (graphFilePackagePathPattern.test(text)) failures.push(`${file}: graphFile snippets must use copied workspace-local filenames, not package example paths`);
	}
}

function checkNoRootStaleNotes(): void {
	for (const file of ["AGENTS.md", "ARCH.md", "CONTINUE.md", "HANDOFF.md", "PLAN.md", "TODO.md", "VISION.md"]) {
		if (existsSync(join(packageRoot, file))) failures.push(`${file}: root stale notes/control-plane files must not exist in this package; use current source/docs/tests as truth`);
	}
}

function checkReleaseHandoffContract(): void {
	const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
	const publicReleaseFoundry = readFileSync(join(packageRoot, "examples/graphs/public-release-foundry.json"), "utf8");
	const parsed: unknown = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	if (!isObject(parsed)) {
		failures.push("package.json: release handoff contract requires object metadata");
		return;
	}
	for (const fragment of ["Public npm release handoff", "pnpm run check:release", "npm publish --dry-run --json", "npm whoami", "npm publish", "GitHub Release creation", "gh release create v<version>", "gh release view v<version>", "npm view pi-multiagent@<version>", "pi install npm:pi-multiagent@<version>", "https://unpkg.com/pi-multiagent@<version>/assets/pi-multiagent-gallery.webp", "human-owned", "not required", "`npm pack --dry-run --json` creates no `.tgz`"]) {
		if (!readme.includes(fragment)) failures.push(`README.md: missing release handoff copy ${JSON.stringify(fragment)}`);
	}
	if (!publicReleaseFoundry.includes("README Public npm release handoff") || !publicReleaseFoundry.includes("not-executed human-owned next actions") || !publicReleaseFoundry.includes("GitHub Release creation") || !publicReleaseFoundry.includes("gh release view verification")) failures.push("examples/graphs/public-release-foundry.json: release synthesis must point at README handoff and preserve publish/GitHub Release steps as not-executed human-owned actions");
	if (parsed.packageManager !== "pnpm@11.1.2") failures.push("package.json: packageManager must pin the release package manager used by this repository");
	if (!isObject(parsed.engines) || typeof parsed.engines.node !== "string") failures.push("package.json: engines.node must document supported runtime floor");
	if (!isObject(parsed.publishConfig) || parsed.publishConfig.access !== "public") failures.push("package.json: publishConfig.access must be public for release handoff clarity");
	if (!isObject(parsed.scripts) || parsed.scripts["check:release"] !== "node --experimental-strip-types tests/check-release-ready.ts") failures.push("package.json: scripts.check:release must run the release identity guard");
}

function checkPackageGalleryMetadata(): void {
	const parsed: unknown = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	if (!isObject(parsed) || !isObject(parsed.pi)) {
		failures.push("package.json: missing pi manifest object");
		return;
	}
	if (parsed.pi.image !== "https://unpkg.com/pi-multiagent/assets/pi-multiagent-gallery.webp") failures.push("package.json: pi.image must point at the packaged gallery preview asset");
	const assetPath = join(packageRoot, "assets", "pi-multiagent-gallery.webp");
	if (!existsSync(assetPath)) {
		failures.push("assets/pi-multiagent-gallery.webp: package-gallery image is missing");
		return;
	}
	const webp = readFileSync(assetPath);
	const isWebp = webp.length >= 30 && webp.subarray(0, 4).toString("ascii") === "RIFF" && webp.subarray(8, 12).toString("ascii") === "WEBP";
	if (!isWebp) {
		failures.push("assets/pi-multiagent-gallery.webp: package-gallery image must be WebP");
		return;
	}
	const chunk = webp.subarray(12, 16).toString("ascii");
	let width = 0;
	let height = 0;
	if (chunk === "VP8 ") {
		width = webp.readUInt16LE(26) & 0x3fff;
		height = webp.readUInt16LE(28) & 0x3fff;
	} else if (chunk === "VP8X") {
		width = webp.readUIntLE(24, 3) + 1;
		height = webp.readUIntLE(27, 3) + 1;
	} else if (chunk === "VP8L") {
		const b1 = webp[21];
		const b2 = webp[22];
		const b3 = webp[23];
		const b4 = webp[24];
		width = 1 + (((b2 & 0x3f) << 8) | b1);
		height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
	}
	if (width !== 1600 || height !== 1000) failures.push(`assets/pi-multiagent-gallery.webp: expected 1600x1000 preview, got ${width}x${height}`);
}

function requireFragments(file: string, text: string, fragments: string[]): void {
	for (const fragment of fragments) if (!text.includes(fragment)) failures.push(`${file}: missing public contract invariant ${JSON.stringify(fragment)}`);
}

function lineNumberAt(text: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
	return line;
}
