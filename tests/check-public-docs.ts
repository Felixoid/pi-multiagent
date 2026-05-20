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
	MAX_RUN_STATUS_WAIT_SECONDS,
	MAX_STEPS,
	MAX_TERMINAL_RETENTION_SECONDS,
	MAX_TIMEOUT_SECONDS_PER_STEP,
	RPC_RECORD_MAX_CHARS,
} from "../extensions/multiagent/src/types.ts";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageMetadata = readPackageMetadata();
const version = packageMetadata.version;
const packageFileAllowlist = packageMetadata.files;
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
checkPublicSurfaceOwnership();
checkActionSnippetHygiene();
checkTimeoutContract();
checkLimitsContract();
checkGraphExamples();
checkLocalControlPlaneDocs();
checkPackageGalleryMetadata();
checkReleaseHandoffContract();

assert.equal(failures.length, 0, `Public package portability checks failed:\n${failures.join("\n")}`);

function readPackageMetadata(): { version: string; files: string[] } {
	const parsed: unknown = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	if (!isObject(parsed) || typeof parsed.version !== "string") throw new Error("package.json must contain a string version");
	if (!Array.isArray(parsed.files) || !parsed.files.every((item) => typeof item === "string")) throw new Error("package.json files must be a string array");
	return { version: parsed.version, files: parsed.files };
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

function checkPublicSurfaceOwnership(): void {
	const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
	const skill = readFileSync(join(packageRoot, "skills/pi-multiagent/SKILL.md"), "utf8");
	const cookbook = readFileSync(join(packageRoot, "skills/pi-multiagent/references/graph-cookbook.md"), "utf8");
	requireFragments("README.md", readme, ["human/operator path", "minimum read-only run", "Cleanup is evidence deletion, not routine hygiene", "Retained detached runs", "cleanup frees only terminal retained runs", "cwd` narrows launch working context", "not path confinement", "does not add a read sandbox", "Copy/adapt warning", "release-readiness-review.json", "pnpm run gate", "pushed notices are compact human receipts and omit the full child transcript", "Assistant text previews require `preview:true`", "raw events require `debugEvents:true`", "Every child process keeps at least the filesystem read/discovery suite", "effective tools", "Exact duplicate keys reuse the original receipt, whether accepted, denied, or timed out", "model/provider availability follows normal Pi extension discovery", "callable extension-tool grants", "Graph authority does not disable or gate this normal Pi extension discovery", "project/local explicit `extensionTools` grants"]);
	requireFragments("skills/pi-multiagent/SKILL.md", skill, ["Action controls are strict", "Pseudo-schema, by action", "Tool profile decision matrix", "Graph design ladder", "coarse child-process authority", "not path-scoped authority", "cwd` narrows launch working context", "not path confinement", "does not add a read sandbox", "mutationScope", "Improving this package", "compact pushed notices are untrusted human receipts and omit the full child transcript", "assistant text previews require `preview:true`", "raw events require `debugEvents:true`", "Every child keeps mandatory read/discovery", "Exact duplicate keys reuse the original receipt, whether accepted, denied, or timed out", "normal Pi extension discovery for model providers", "callable tool-name allowlist", "Graph authority does not disable or gate this normal Pi extension discovery", "project/local explicit `extensionTools` grants"]);
	requireFragments("skills/pi-multiagent/references/graph-cookbook.md", cookbook, ["Choose a graph shape first", "Graph design ladder", "Task packet templates", "Mapper packet", "Reducer packet", "Validator packet", "Worker packet", "Map-reduce audit fanout", "static DAG reduce pattern", "Copy/adapt warning", "Do not run them verbatim", "graphFile", "mutationScope", "Web Research Extension Lane", "Add `preview:true` only when bounded assistant text belongs", "Use `debugEvents:true` only for package debugging", "Every child keeps mandatory read/discovery", "Exact duplicate keys reuse the original receipt, whether accepted, denied, or timed out"]);
	for (const file of ["README.md", "CHANGELOG.md", "skills/pi-multiagent/SKILL.md", "skills/pi-multiagent/references/graph-cookbook.md"]) {
		const text = readFileSync(join(packageRoot, file), "utf8");
		for (const excluded of ["\"action\": \"run\"", "\"synthesis\"", "\"outputContract\"", "allowSideEffectTools", "Retained terminal runs", "read sandbox inside cwd", "path sandbox", "confined to cwd", "foreground `run`", "foreground/blocking", "old in-memory", "Public npm release handoff", "README Public npm release handoff", "without ambient extensions", "do not inherit ambient extensions", "extensions are disabled unless", "children do not load ambient Pi extensions", "project/local extension sources, and project/temporary caller skill sources"]) if (text.includes(excluded)) failures.push(`${file}: public docs must not include stale, unsupported, or owner-private contract copy ${JSON.stringify(excluded)}`);
	}
}


function checkActionSnippetHygiene(): void {
	for (const file of ["README.md", "skills/pi-multiagent/references/graph-cookbook.md"]) {
		const text = readFileSync(join(packageRoot, file), "utf8");
		if (text.includes('"cursor": "0"')) failures.push(`${file}: routine run_status snippets must not include cursor:"0"; cursor is for prior run_status/debug backfill`);
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
		`\`waitSeconds\` max ${MAX_RUN_STATUS_WAIT_SECONDS} seconds`,
		`| Live detached runs | ${MAX_LIVE_DETACHED_RUNS} live runs per extension process; completion or cancel frees live capacity |`,
		`| Retained detached runs | ${MAX_RETAINED_DETACHED_RUNS} retained runs per extension process, including live and terminal runs; cleanup frees only terminal retained runs |`,
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
		if (file === "examples/graphs/release-readiness-review.json") checkReleaseReadinessExample(file, parsed);
		if (file === "examples/graphs/public-release-foundry.json") checkReleaseFoundryExample(file, parsed);
		if (file === "examples/graphs/map-reduce-audit-fanout.json") checkMapReduceExample(file, parsed);
	}
	const graphFilePackagePathPattern = /"graphFile"\s*:\s*"examples\/graphs\//;
	for (const file of ["README.md", "skills/pi-multiagent/references/graph-cookbook.md"]) {
		const text = readFileSync(join(packageRoot, file), "utf8");
		if (graphFilePackagePathPattern.test(text)) failures.push(`${file}: graphFile snippets must use copied workspace-local filenames, not package example paths`);
	}
}

function checkReleaseReadinessExample(file: string, graph: { [key: string]: unknown }): void {
	const authority = graph.authority;
	if (!isObject(authority) || authority.allowFilesystemRead !== true || authority.allowShellTools !== true || authority.allowMutationTools === true) failures.push(`${file}: release-readiness graph must be read/shell only with no mutation authority`);
	if (!isObject(graph.limits) || graph.limits.concurrency !== 1) failures.push(`${file}: release-readiness graph must serialize shell proof lanes`);
	const graphText = JSON.stringify(graph);
	if (graphText.includes("mutationScope")) failures.push(`${file}: release-readiness graph must not contain mutationScope`);
	if (stepAgentRef(file, graph, "release-map") !== "package:scout") failures.push(`${file}: release-map must use package:scout for file-only release mapping`);
	if (stepAgentRef(file, graph, "release-proof") !== "package:validator") failures.push(`${file}: release-proof must use package:validator for command-backed release proof`);
	const auditAfter = stepStringArray(file, graph, "release-audit", "after");
	if (auditAfter.join(",") !== "release-map,release-proof") failures.push(`${file}: release-audit must wait after both release-map and release-proof so failed or blocked proof is preserved`);
	const decisionAfter = stepStringArray(file, graph, "readiness-decision", "after");
	if (decisionAfter.join(",") !== "release-map,release-proof,release-audit") failures.push(`${file}: readiness-decision must preserve terminal evidence from every release lane`);
	const proofTask = stepTask(file, graph, "release-proof");
	if (!proofTask.includes("REPLACE_WITH_EXACT_READ_ONLY_RELEASE_COMMANDS") || !proofTask.includes("needs-command-scope") || !proofTask.includes("Do not edit")) failures.push(`${file}: release-proof must fail closed on missing parent-copied command scope`);
}

function checkReleaseFoundryExample(file: string, graph: { [key: string]: unknown }): void {
	if (stepAgentRef(file, graph, "release-map") !== "package:scout") failures.push(`${file}: release-map must use package:scout for file-only release mapping`);
	if (stepAgentRef(file, graph, "release-probes") !== "package:validator") failures.push(`${file}: release-probes must use package:validator for command-backed release proof`);
	const after = stepStringArray(file, graph, "artifact-audit", "after");
	if (after.join(",") !== "release-map,release-probes") failures.push(`${file}: artifact-audit must wait after both release-map and release-probes so failed or blocked proof is preserved`);
	const probesTask = stepTask(file, graph, "release-probes");
	if (!probesTask.includes("REPLACE_WITH_EXACT_RELEASE_PROBE_COMMANDS") || !probesTask.includes("needs-command-scope") || !probesTask.includes("Run only those commands")) failures.push(`${file}: release-probes must fail closed on missing parent-copied command scope`);
	for (const stepId of ["release-map", "release-probes", "artifact-audit", "release-fix-worker", "release-validation", "ship-decision"]) {
		if (!stepTask(file, graph, stepId).includes("Do not version-bump, commit, tag, push, publish, delete, install, deploy, or create GitHub Releases")) failures.push(`${file}:${stepId} must carry the full release-action denial list`);
	}
	const workerScope = exampleStep(file, graph, "release-fix-worker").mutationScope;
	if (typeof workerScope !== "string" || !workerScope.includes("version bump, commit, tag, push, publish, delete, install, deploy, GitHub Release creation")) failures.push(`${file}: release-fix-worker mutationScope must carry the full release-action denial list`);
	if (!String(graph.objective).includes("release-readiness-review.json")) failures.push(`${file}: release foundry objective must point to the default non-mutating readiness graph`);
}

function checkMapReduceExample(file: string, graph: { [key: string]: unknown }): void {
	if (!String(graph.objective).includes("local evidence surfaces")) failures.push(`${file}: map-reduce objective must stay generally reusable`);
	for (const stepId of ["map-runtime", "map-docs", "map-tests"]) {
		const task = stepTask(file, graph, stepId);
		if (!task.includes("concrete delegated question")) failures.push(`${file}:${stepId} must reference the concrete delegated question, not package-specific surfaces`);
		if (!task.includes("NEEDS-SCOPE") || !task.includes("without broad repo search")) failures.push(`${file}:${stepId} must fail closed when copied without concrete parent scope`);
		if (!task.includes("surface, owner or canonical path, evidence, risk or mismatch, validation gap, and smallest next action")) failures.push(`${file}:${stepId} must preserve mapper output packet fields`);
	}
	const reduceTask = stepTask(file, graph, "reduce-decision");
	if (!reduceTask.includes("reducer packet") || !reduceTask.includes("observed validation versus claimed validation")) failures.push(`${file}: reducer must preserve decision packet fields and validation distinction`);
}

function stepAgentRef(file: string, graph: { [key: string]: unknown }, id: string): string {
	const step = exampleStep(file, graph, id);
	return isObject(step.agent) && typeof step.agent.ref === "string" ? step.agent.ref : "";
}

function stepTask(file: string, graph: { [key: string]: unknown }, id: string): string {
	const task = exampleStep(file, graph, id).task;
	return typeof task === "string" ? task : "";
}

function stepStringArray(file: string, graph: { [key: string]: unknown }, id: string, key: string): string[] {
	const value = exampleStep(file, graph, id)[key];
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function exampleStep(file: string, graph: { [key: string]: unknown }, id: string): { [key: string]: unknown } {
	const steps = graph.steps;
	if (!Array.isArray(steps)) return {};
	const step = steps.find((candidate): candidate is { [key: string]: unknown } => isObject(candidate) && candidate.id === id);
	if (!step) failures.push(`${file}: missing graph step ${id}`);
	return step ?? {};
}

function checkLocalControlPlaneDocs(): void {
	for (const file of ["ARCH.md", "TODO.md", "VISION.md"]) {
		if (existsSync(join(packageRoot, file))) failures.push(`${file}: root public-planning notes are not package source; keep package truth in current source/docs/tests or classify the local note explicitly before relying on it`);
	}
	for (const file of ["AGENTS.md", "CONTINUE.md", "HANDOFF.md", "PLAN.md"]) {
		if (!existsSync(join(packageRoot, file))) continue;
		if (publicFiles.includes(file) || packageAllowlistCouldIncludeRootFile(file)) failures.push(`${file}: local control-plane docs may exist in the workspace but package.json files must not include or broadly admit them`);
	}
}

function packageAllowlistCouldIncludeRootFile(file: string): boolean {
	return packageFileAllowlist.some((pattern) => rootPackagePatternMatches(pattern, file));
}

function rootPackagePatternMatches(pattern: string, file: string): boolean {
	if (pattern === file || pattern === "." || pattern === "*" || pattern === "**" || pattern === "**/*") return true;
	if (pattern.includes("/")) return false;
	if (!pattern.includes("*")) return false;
	return globSegmentPattern(pattern).test(file);
}

function globSegmentPattern(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
	return new RegExp(`^${escaped}$`);
}

function checkReleaseHandoffContract(): void {
	const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
	const releaseReadiness = readFileSync(join(packageRoot, "examples/graphs/release-readiness-review.json"), "utf8");
	const publicReleaseFoundry = readFileSync(join(packageRoot, "examples/graphs/public-release-foundry.json"), "utf8");
	const parsed: unknown = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	if (!isObject(parsed)) {
		failures.push("package.json: release guardrail contract requires object metadata");
		return;
	}
	for (const fragment of ["Public npm release handoff", "npm publish --dry-run --json", "npm whoami", "gh release create v<version>", "gh release view v<version>", "https://unpkg.com/pi-multiagent@<version>/assets/pi-multiagent-gallery.webp", "release lineage guard", "HEAD:package.json", "clean release commit"]) {
		if (readme.includes(fragment)) failures.push(`README.md: public user README must not carry owner-private release handoff copy ${JSON.stringify(fragment)}`);
	}
	const smokeCommandIndex = readme.indexOf("PI_MULTIAGENT_REAL_SMOKE=1 PI_MULTIAGENT_REAL_SMOKE_TIMEOUT_MS=180000 pnpm run smoke:pi");
	const smokeApprovalIndex = readme.indexOf("Run it only with explicit operator approval");
	if (smokeCommandIndex === -1 || smokeApprovalIndex === -1 || Math.abs(smokeCommandIndex - smokeApprovalIndex) > 300) failures.push("README.md: real-runtime smoke command must keep explicit operator approval caveat adjacent");
	if (!releaseReadiness.includes("not-executed human-owned next actions") || !releaseReadiness.includes("npm publish") || !releaseReadiness.includes("GitHub Release creation") || !releaseReadiness.includes("gh release view verification")) failures.push("examples/graphs/release-readiness-review.json: readiness decision must preserve publish/GitHub Release steps as not-executed human-owned actions");
	if (publicReleaseFoundry.includes("README Public npm release handoff") || publicReleaseFoundry.includes("Public npm release handoff")) failures.push("examples/graphs/public-release-foundry.json: release synthesis must not point public users at README release handoff copy");
	if (!publicReleaseFoundry.includes("not-executed human-owned next actions") || !publicReleaseFoundry.includes("npm publish") || !publicReleaseFoundry.includes("GitHub Release creation") || !publicReleaseFoundry.includes("gh release view verification")) failures.push("examples/graphs/public-release-foundry.json: release synthesis must preserve publish/GitHub Release steps as not-executed human-owned actions");
	if (parsed.packageManager !== "pnpm@11.1.2") failures.push("package.json: packageManager must pin the release package manager used by this repository");
	if (!isObject(parsed.engines) || typeof parsed.engines.node !== "string") failures.push("package.json: engines.node must document supported runtime floor");
	if (!isObject(parsed.publishConfig) || parsed.publishConfig.access !== "public") failures.push("package.json: publishConfig.access must remain public for npm package metadata");
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
