import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { catalogAgents, discoverAgents, findNearestProjectAgentsDir, normalizeLibraryOptions } from "../extensions/multiagent/src/agents.ts";
import { readAgentFileContent } from "../extensions/multiagent/src/agent-file-content.ts";
import { MAX_AGENT_FILE_BYTES } from "../extensions/multiagent/src/types.ts";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function makeAgent(dir: string, file: string, body: string): Promise<void> {
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, file), body, "utf8");
}

test("discoverAgents preserves source-qualified refs across sources", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-agents-"));
	const packageDir = join(root, "package-agents");
	const userDir = join(root, "user-agents");
	await makeAgent(packageDir, "scout.md", "---\nname: scout\ndescription: package scout\ntools: read, grep\n---\nPackage prompt");
	await makeAgent(userDir, "scout.md", "---\nname: scout\ndescription: user scout\n---\nUser prompt");
	const discovery = discoverAgents({
		cwd: root,
		packageAgentsDir: packageDir,
		userAgentsDir: userDir,
		library: normalizeLibraryOptions({ sources: ["package", "user"] }),
	});
	assert.deepEqual(discovery.agents.map((agent) => agent.ref), ["package:scout", "user:scout"]);
	assert.equal(discovery.agents.find((agent) => agent.ref === "user:scout")?.description, "user scout");
	await rm(root, { recursive: true, force: true });
});

test("discoverAgents parses CRLF frontmatter", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-crlf-"));
	const packageDir = join(root, "package-agents");
	await makeAgent(packageDir, "crlf.md", "---\r\nname: crlf\r\ndescription: windows newlines\r\n---\r\nPrompt");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, library: normalizeLibraryOptions({ sources: ["package"] }) });
	assert.equal(discovery.agents[0]?.name, "crlf");
	assert.equal(discovery.agents[0]?.systemPrompt, "Prompt");
	await rm(root, { recursive: true, force: true });
});

test("discoverAgents rejects oversized agent files", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-agent-large-"));
	const packageDir = join(root, "package-agents");
	await makeAgent(packageDir, "large.md", `---\nname: large\ndescription: large agent\n---\n${"x".repeat(MAX_AGENT_FILE_BYTES)}`);
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, library: normalizeLibraryOptions({ sources: ["package"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics.some((item) => item.code === "agent-file-too-large"), true);
	await rm(root, { recursive: true, force: true });
});

test("readAgentFileContent rechecks post-open containment", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-read-agent-containment-"));
	const packageDir = join(root, "package-agents");
	const outsideDir = join(root, "outside");
	await mkdir(packageDir, { recursive: true });
	await mkdir(outsideDir, { recursive: true });
	const outsideTarget = join(outsideDir, "target.md");
	await writeFile(outsideTarget, "---\nname: outside\ndescription: outside\n---\nOutside", "utf8");
	const outsideRead = readAgentFileContent(outsideTarget, { containmentRoot: packageDir });
	assert.equal(outsideRead.ok, false);
	assert.match(outsideRead.error ?? "", /path escape denied/);
	await rm(root, { recursive: true, force: true });
});

test("readAgentFileContent rejects symlink targets at read time", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-read-agent-symlink-"));
	const packageDir = join(root, "package-agents");
	const outsideDir = join(root, "outside");
	await mkdir(packageDir, { recursive: true });
	await mkdir(outsideDir, { recursive: true });
	const safePath = join(packageDir, "agent.md");
	const outsideTarget = join(outsideDir, "target.md");
	await writeFile(safePath, "---\nname: safe\ndescription: safe\n---\nSafe", "utf8");
	await writeFile(outsideTarget, "---\nname: outside\ndescription: outside\n---\nOutside", "utf8");
	const safeRead = readAgentFileContent(safePath);
	assert.equal(safeRead.ok, true);
	assert.match(safeRead.content, /Safe/);
	await rm(safePath);
	await symlink(outsideTarget, safePath);
	const symlinkRead = readAgentFileContent(safePath);
	assert.equal(symlinkRead.ok, false);
	assert.match(symlinkRead.error ?? "", /No such|symbolic|ELOOP|follow/i);
	await rm(root, { recursive: true, force: true });
});

test("discoverAgents reports invalid agent definitions", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-invalid-"));
	const packageDir = join(root, "package-agents");
	await makeAgent(packageDir, "bad.md", "---\nname: Bad Name\ndescription: bad\nthinking: sideways\n---\nNope");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, library: normalizeLibraryOptions({ sources: ["package"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics.length, 1);
	assert.equal(discovery.diagnostics[0].code, "agent-name-invalid");
	await rm(root, { recursive: true, force: true });
});

test("discoverAgents rejects invalid library-declared tools", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-invalid-tools-"));
	const packageDir = join(root, "package-agents");
	await makeAgent(packageDir, "bad-tools.md", "---\nname: bad-tools\ndescription: bad tools\ntools: read, bad/tool\n---\nNope");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, library: normalizeLibraryOptions({ sources: ["package"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics[0].code, "agent-tools-invalid");
	await rm(root, { recursive: true, force: true });
});

test("discoverAgents rejects unavailable library-declared tools", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-unavailable-tools-"));
	const packageDir = join(root, "package-agents");
	await makeAgent(packageDir, "bad-tools.md", "---\nname: bad-tools\ndescription: bad tools\ntools: read, webFetch\n---\nNope");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, library: normalizeLibraryOptions({ sources: ["package"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics.some((item) => item.code === "agent-tool-invalid" && item.message.includes("webFetch")), true);
	await rm(root, { recursive: true, force: true });
});

test("discoverAgents parses and validates routing tags", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-tags-"));
	const packageDir = join(root, "package-agents");
	await makeAgent(packageDir, "tagged.md", "---\nname: tagged\ndescription: tagged agent\ntags: Web, online, web, pre-mortem-review\n---\nPrompt");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, library: normalizeLibraryOptions({ sources: ["package"] }) });
	assert.deepEqual(discovery.agents[0]?.tags, ["web", "online", "pre-mortem-review"]);
	const catalog = catalogAgents(discovery, "pre-mortem review");
	assert.equal(catalog[0]?.ref, "package:tagged");
	assert.deepEqual(catalog[0]?.tags, ["web", "online", "pre-mortem-review"]);
	await rm(root, { recursive: true, force: true });
});

test("discoverAgents rejects invalid routing tags", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-invalid-tags-"));
	const packageDir = join(root, "package-agents");
	await makeAgent(packageDir, "bad-tags.md", "---\nname: bad-tags\ndescription: bad tags\ntags: ok, bad_tag\n---\nNope");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, library: normalizeLibraryOptions({ sources: ["package"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics.some((item) => item.code === "agent-tags-invalid" && item.message.includes("bad_tag")), true);
	await rm(root, { recursive: true, force: true });
});

test("discoverAgents rejects library self-declared extension tool grants", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-extension-tools-frontmatter-"));
	const packageDir = join(root, "package-agents");
	await makeAgent(packageDir, "web.md", "---\nname: web\ndescription: web agent\nextensionTools: exa_search\n---\nNope");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, library: normalizeLibraryOptions({ sources: ["package"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics.some((item) => item.code === "agent-extension-tools-denied"), true);
	await rm(root, { recursive: true, force: true });
});

test("discoverAgents rejects library self-declared caller skill inheritance", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-caller-skills-frontmatter-"));
	const packageDir = join(root, "package-agents");
	await makeAgent(packageDir, "skilled.md", "---\nname: skilled\ndescription: skilled agent\ncallerSkills: none\n---\nNope");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, library: normalizeLibraryOptions({ sources: ["package"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics.some((item) => item.code === "agent-caller-skills-denied"), true);
	await rm(root, { recursive: true, force: true });
});

test("discoverAgents reports duplicate source refs only", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-duplicate-refs-"));
	const packageDir = join(root, "package-agents");
	await makeAgent(packageDir, "one.md", "---\nname: dup\ndescription: one\n---\nOne");
	await makeAgent(packageDir, "two.md", "---\nname: dup\ndescription: two\n---\nTwo");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, library: normalizeLibraryOptions({ sources: ["package"] }) });
	assert.equal(discovery.agents.length, 1);
	assert.equal(discovery.diagnostics.some((item) => item.code === "agent-ref-duplicate"), true);
	await rm(root, { recursive: true, force: true });
});

test("global Pi directory is not treated as project agents or project-scoped user agents", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-global-pi-"));
	const globalPiDir = join(root, ".pi");
	const userDir = join(globalPiDir, "agent", "agents");
	const packageDir = join(root, "package-agents");
	const project = join(root, "Code", "repo");
	await mkdir(join(project, ".git"), { recursive: true });
	await makeAgent(userDir, "user.md", "---\nname: user\ndescription: user agent\n---\nUser prompt");
	await makeAgent(join(globalPiDir, "agents"), "global-project.md", "---\nname: global-project\ndescription: not project\n---\nGlobal prompt");
	const projectAgentsDir = findNearestProjectAgentsDir(project, globalPiDir);
	const discovery = discoverAgents({ cwd: project, packageAgentsDir: packageDir, userAgentsDir: userDir, globalPiDir, library: normalizeLibraryOptions({ sources: ["user", "project"], projectAgents: "allow" }) });
	assert.equal(projectAgentsDir, undefined);
	assert.deepEqual(discovery.agents.map((agent) => agent.ref), ["user:user"]);
	assert.equal(discovery.diagnostics.some((item) => item.code === "user-agents-dir-project-scoped"), false);
	await rm(root, { recursive: true, force: true });
});

test("project source is denied by default", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-project-deny-"));
	const packageDir = join(root, "package-agents");
	const projectDir = join(root, ".pi", "agents");
	await makeAgent(projectDir, "repo.md", "---\nname: repo\ndescription: repo agent\n---\nRepo prompt");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, library: normalizeLibraryOptions({ sources: ["project"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics[0].code, "project-agents-denied");
	await rm(root, { recursive: true, force: true });
});

test("project source confirm fails closed when discovery is not preprocessed", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-project-confirm-"));
	const packageDir = join(root, "package-agents");
	const projectDir = join(root, ".pi", "agents");
	await makeAgent(projectDir, "repo.md", "---\nname: repo\ndescription: repo agent\n---\nRepo prompt");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, library: normalizeLibraryOptions({ sources: ["project"], projectAgents: "confirm" }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics.some((item) => item.code === "project-agents-confirm-unprepared" && item.severity === "error"), true);
	await rm(root, { recursive: true, force: true });
});

test("project-scoped user agent directory is denied", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-user-project-scoped-"));
	const packageDir = join(root, "package-agents");
	const userDir = join(root, ".pi", "agents");
	await makeAgent(userDir, "repo.md", "---\nname: repo\ndescription: repo agent\n---\nRepo prompt");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, userAgentsDir: userDir, library: normalizeLibraryOptions({ sources: ["user"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics.some((item) => item.code === "user-agents-dir-project-scoped" && item.severity === "error"), true);
	await rm(root, { recursive: true, force: true });
});

test("project-root user agent directory is denied", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-user-project-root-"));
	const packageDir = join(root, "package-agents");
	const userDir = join(root, "agents");
	await mkdir(join(root, ".pi"), { recursive: true });
	await makeAgent(userDir, "repo.md", "---\nname: repo\ndescription: repo agent\n---\nRepo prompt");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, userAgentsDir: userDir, library: normalizeLibraryOptions({ sources: ["user"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics.some((item) => item.code === "user-agents-dir-project-scoped" && item.severity === "error"), true);
	await rm(root, { recursive: true, force: true });
});

test("project-root user agent directory is denied when git marker is a file", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-user-project-git-file-"));
	const packageDir = join(root, "package-agents");
	const userDir = join(root, "agents");
	await writeFile(join(root, ".git"), "gitdir: ../real-git\n", "utf8");
	await makeAgent(userDir, "repo.md", "---\nname: repo\ndescription: repo agent\n---\nRepo prompt");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, userAgentsDir: userDir, library: normalizeLibraryOptions({ sources: ["user"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics.some((item) => item.code === "user-agents-dir-project-scoped" && item.severity === "error"), true);
	await rm(root, { recursive: true, force: true });
});

test("project-root user agent directory is denied when pi marker is a file or symlink", async () => {
	const cases = ["file", "symlink", "dangling-symlink"] as const;
	for (const markerKind of cases) {
		const root = await mkdtemp(join(tmpdir(), `pi-multiagent-user-project-pi-${markerKind}-`));
		const packageDir = join(root, "package-agents");
		const userDir = join(root, "agents");
		const marker = join(root, ".pi");
		if (markerKind === "file") await writeFile(marker, "settings marker\n", "utf8");
		else if (markerKind === "symlink") {
			const target = join(root, "pi-marker-target");
			await writeFile(target, "settings marker\n", "utf8");
			await symlink(target, marker);
		} else await symlink(join(root, "missing-pi-marker-target"), marker);
		await makeAgent(userDir, "repo.md", "---\nname: repo\ndescription: repo agent\n---\nRepo prompt");
		const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, userAgentsDir: userDir, library: normalizeLibraryOptions({ sources: ["user"] }) });
		assert.equal(discovery.agents.length, 0, markerKind);
		assert.equal(discovery.diagnostics.some((item) => item.code === "user-agents-dir-project-scoped" && item.severity === "error"), true, markerKind);
		await rm(root, { recursive: true, force: true });
	}
});

test("project-root user agent directory is denied through symlink", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-user-project-root-link-"));
	const outside = await mkdtemp(join(tmpdir(), "pi-multiagent-user-root-link-outside-"));
	const packageDir = join(root, "package-agents");
	const projectAgents = join(root, "agents");
	const userDir = join(outside, "agents-link");
	await mkdir(join(root, ".pi"), { recursive: true });
	await makeAgent(projectAgents, "repo.md", "---\nname: repo\ndescription: repo agent\n---\nRepo prompt");
	await symlink(projectAgents, userDir);
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, userAgentsDir: userDir, library: normalizeLibraryOptions({ sources: ["user"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics.some((item) => item.code === "user-agents-dir-project-scoped" && item.severity === "error"), true);
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
});

test("nested project-scoped user agent directory is denied without project agents dir", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-user-project-nested-"));
	const packageDir = join(root, "package-agents");
	const nested = join(root, "src");
	const userDir = join(root, ".pi", "agent", "agents");
	await mkdir(nested, { recursive: true });
	await makeAgent(userDir, "repo.md", "---\nname: repo\ndescription: repo agent\n---\nRepo prompt");
	const discovery = discoverAgents({ cwd: nested, packageAgentsDir: packageDir, userAgentsDir: userDir, library: normalizeLibraryOptions({ sources: ["user"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics.some((item) => item.code === "user-agents-dir-project-scoped" && item.severity === "error"), true);
	await rm(root, { recursive: true, force: true });
});

test("nested project-scoped user agent directory is denied through cwd symlink", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-user-project-nested-link-"));
	const outside = await mkdtemp(join(tmpdir(), "pi-multiagent-user-project-nested-outside-"));
	const packageDir = join(root, "package-agents");
	const nested = join(root, "src");
	const linkedNested = join(outside, "linked-src");
	const userDir = join(root, ".pi", "agent", "agents");
	await mkdir(nested, { recursive: true });
	await makeAgent(userDir, "repo.md", "---\nname: repo\ndescription: repo agent\n---\nRepo prompt");
	await symlink(nested, linkedNested, "dir");
	const discovery = discoverAgents({ cwd: linkedNested, packageAgentsDir: packageDir, userAgentsDir: userDir, library: normalizeLibraryOptions({ sources: ["user"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics.some((item) => item.code === "user-agents-dir-project-scoped" && item.severity === "error"), true);
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
});

test("project-scoped user agent directory is denied through symlink", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-user-project-symlink-"));
	const outside = await mkdtemp(join(tmpdir(), "pi-multiagent-user-link-"));
	const packageDir = join(root, "package-agents");
	const projectDir = join(root, ".pi", "agents");
	const userDir = join(outside, "agents-link");
	await makeAgent(projectDir, "repo.md", "---\nname: repo\ndescription: repo agent\n---\nRepo prompt");
	await symlink(projectDir, userDir);
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, userAgentsDir: userDir, library: normalizeLibraryOptions({ sources: ["user"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics.some((item) => item.code === "user-agents-dir-project-scoped" && item.severity === "error"), true);
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
});

test("user agent file symlinks are denied", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-user-file-symlink-"));
	const outside = await mkdtemp(join(tmpdir(), "pi-multiagent-user-file-outside-"));
	const packageDir = join(root, "package-agents");
	const userDir = join(root, "user-agents");
	await mkdir(userDir, { recursive: true });
	await writeFile(join(outside, "linked.md"), "---\nname: linked\ndescription: linked agent\n---\nLinked prompt", "utf8");
	await symlink(join(outside, "linked.md"), join(userDir, "linked.md"));
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, userAgentsDir: userDir, library: normalizeLibraryOptions({ sources: ["user"] }) });
	assert.equal(discovery.agents.length, 0);
	assert.equal(discovery.diagnostics.some((item) => item.code === "user-agent-symlink-denied"), true);
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
});

test("project agents deny symlinks and keep source-qualified refs", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-project-policy-"));
	const outside = await mkdtemp(join(tmpdir(), "pi-multiagent-outside-"));
	const packageDir = join(root, "package-agents");
	const projectDir = join(root, ".pi", "agents");
	await makeAgent(packageDir, "reviewer.md", "---\nname: reviewer\ndescription: package reviewer\n---\nPackage prompt");
	await makeAgent(projectDir, "reviewer.md", "---\nname: reviewer\ndescription: project reviewer\n---\nProject prompt");
	await writeFile(join(outside, "external.md"), "---\nname: external\ndescription: external\n---\nExternal prompt", "utf8");
	await symlink(join(outside, "external.md"), join(projectDir, "external.md"));
	const discovery = discoverAgents({
		cwd: root,
		packageAgentsDir: packageDir,
		library: normalizeLibraryOptions({ sources: ["package", "project"], projectAgents: "allow" }),
	});
	assert.deepEqual(discovery.agents.map((agent) => `${agent.source}:${agent.name}`), ["package:reviewer", "project:reviewer"]);
	assert.equal(discovery.diagnostics.some((item) => item.code === "project-agent-symlink-denied"), true);
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
});

test("project agents deny symlinked agents directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-project-dir-symlink-"));
	const outside = await mkdtemp(join(tmpdir(), "pi-multiagent-project-dir-outside-"));
	const packageDir = join(root, "package-agents");
	await mkdir(join(root, ".pi"), { recursive: true });
	await makeAgent(outside, "evil.md", "---\nname: evil\ndescription: outside agent\n---\nOutside prompt");
	await symlink(outside, join(root, ".pi", "agents"));
	const discovery = discoverAgents({
		cwd: root,
		packageAgentsDir: packageDir,
		library: normalizeLibraryOptions({ sources: ["project"], projectAgents: "allow" }),
	});
	assert.deepEqual(discovery.agents, []);
	assert.equal(discovery.diagnostics.some((item) => item.code === "project-agent-dir-symlink-denied"), true);
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
});

test("project agents deny symlinked intermediate pi directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-project-pi-symlink-"));
	const outside = await mkdtemp(join(tmpdir(), "pi-multiagent-project-pi-outside-"));
	const packageDir = join(root, "package-agents");
	await makeAgent(join(outside, "agents"), "evil.md", "---\nname: evil\ndescription: outside agent\n---\nOutside prompt");
	await symlink(outside, join(root, ".pi"), "dir");
	assert.equal(findNearestProjectAgentsDir(root), undefined);
	const discovery = discoverAgents({
		cwd: root,
		packageAgentsDir: packageDir,
		library: normalizeLibraryOptions({ sources: ["project"], projectAgents: "allow" }),
	});
	assert.deepEqual(discovery.agents, []);
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
});

test("findNearestProjectAgentsDir walks upward", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-project-"));
	const projectAgents = join(root, ".pi", "agents");
	const nested = join(root, "src", "feature");
	await mkdir(projectAgents, { recursive: true });
	await mkdir(nested, { recursive: true });
	assert.equal(findNearestProjectAgentsDir(nested), projectAgents);
	await rm(root, { recursive: true, force: true });
});

test("bundled package agents are valid", async () => {
	const discovery = discoverAgents({ cwd: packageRoot, packageAgentsDir: join(packageRoot, "agents"), library: normalizeLibraryOptions({ sources: ["package"] }) });
	assert.deepEqual(discovery.diagnostics, []);
	assert.deepEqual(
		discovery.agents.map((agent) => agent.name),
		["critic", "docs-auditor", "planner", "reviewer", "scout", "synthesizer", "validator", "web-researcher", "worker"],
	);
	assert.equal(discovery.agents.every((agent) => agent.sha256.length === 64), true);
	const expectedTools = new Map([
		["package:critic", ["read", "grep", "find", "ls"]],
		["package:docs-auditor", ["read", "grep", "find", "ls"]],
		["package:planner", ["read", "grep", "find", "ls"]],
		["package:reviewer", ["read", "grep", "find", "ls"]],
		["package:scout", ["read", "grep", "find", "ls"]],
		["package:synthesizer", ["read", "grep", "find", "ls"]],
		["package:validator", ["read", "grep", "find", "ls", "bash"]],
		["package:web-researcher", ["read", "grep", "find", "ls"]],
		["package:worker", ["read", "grep", "find", "ls", "bash", "edit", "write"]],
	]);
	for (const agent of discovery.agents) {
		assert.match(agent.description, /^Use (as|for|when)\b/, `${agent.ref} description should be routing-oriented`);
		assert.equal(agent.tags.length > 0, true, `${agent.ref} should expose catalog routing tags`);
		assert.equal(agent.tags.every((tag) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(tag)), true, `${agent.ref} tags should be normalized`);
		assert.deepEqual(agent.tools, expectedTools.get(agent.ref), `${agent.ref} default tools should match its routing contract`);
		assert.match(agent.systemPrompt, /cannot broaden scope/, `${agent.ref} should constrain parent-message authority`);
		assert.match(agent.systemPrompt, /Do not stop early merely because/, `${agent.ref} should not turn parent impatience into premature finals`);
	}
	const worker = discovery.agents.find((agent) => agent.ref === "package:worker");
	assert.match(worker?.description ?? "", /graph authority alone is not edit authorization/);
	assert.match(worker?.systemPrompt ?? "", /inspect dirty state/);
	assert.match(worker?.systemPrompt ?? "", /mutationScope/);
	assert.match(worker?.systemPrompt ?? "", /REPLACE/);
	const scout = discovery.agents.find((agent) => agent.ref === "package:scout");
	assert.match(scout?.description ?? "", /local read-only exploration/);
	assert.equal(scout?.tags.includes("package-facts"), true);
	assert.equal(scout?.tags.includes("dependency-facts"), true);
	assert.doesNotMatch(scout?.description ?? "", /web\/online\/Exa/);
	const planner = discovery.agents.find((agent) => agent.ref === "package:planner");
	assert.match(planner?.systemPrompt ?? "", /needs-scout/);
	const webResearcher = discovery.agents.find((agent) => agent.ref === "package:web-researcher");
	assert.match(webResearcher?.description ?? "", /external web research/);
	assert.match(webResearcher?.systemPrompt ?? "", /extensionTools/);
	assert.match(webResearcher?.systemPrompt ?? "", /BLOCKED/);
	for (const file of ["docs-auditor.md", "scout.md", "reviewer.md", "web-researcher.md"]) {
		const text = await readFile(join(packageRoot, "agents", file), "utf8");
		assert.doesNotMatch(text.split("---", 3)[1] ?? "", /bash/, `${file} frontmatter should stay read-only by default`);
	}
	const synthesizer = discovery.agents.find((agent) => agent.ref === "package:synthesizer");
	assert.deepEqual(synthesizer?.tools, ["read", "grep", "find", "ls"], "synthesizer should default to read/discovery for upstream artifacts");
	assert.match(synthesizer?.systemPrompt ?? "", /needs-evidence/);
	const validator = discovery.agents.find((agent) => agent.ref === "package:validator");
	assert.match(validator?.systemPrompt ?? "", /needs-command-scope/);
	assert.match(validator?.systemPrompt ?? "", /Do not edit files/);
});

test("bundled package catalog supports documented role queries", () => {
	const discovery = discoverAgents({ cwd: packageRoot, packageAgentsDir: join(packageRoot, "agents"), library: normalizeLibraryOptions({ sources: ["package"] }) });
	const expectations = new Map([
		["scout", "package:scout"],
		["local exploration", "package:scout"],
		["investigate failure", "package:scout"],
		["root cause", "package:scout"],
		["debug regression", "package:scout"],
		["node_modules vendor code", "package:scout"],
		["package facts", "package:scout"],
		["dependency facts", "package:scout"],
		["read-only package validation", "package:validator"],
		["web research", "package:web-researcher"],
		["online research", "package:web-researcher"],
		["exa research", "package:web-researcher"],
		["official sources", "package:web-researcher"],
		["planner", "package:planner"],
		["design", "package:planner"],
		["architecture plan", "package:planner"],
		["docs audit", "package:docs-auditor"],
		["microcopy", "package:docs-auditor"],
		["model-facing copy", "package:docs-auditor"],
		["critic", "package:critic"],
		["risk", "package:critic"],
		["pre-implementation", "package:critic"],
		["adversarial review", "package:critic"],
		["pre-mortem review", "package:critic"],
		["adversarial completed path", "package:critic"],
		["risk stress test release path", "package:critic"],
		["reviewer", "package:reviewer"],
		["review", "package:reviewer"],
		["completed work review", "package:reviewer"],
		["completed docs diff review", "package:reviewer"],
		["ordinary completed artifact review", "package:reviewer"],
		["diff validation", "package:validator"],
		["shell validation", "package:validator"],
		["bash validation", "package:validator"],
		["run validation commands", "package:validator"],
		["command proof", "package:validator"],
		["post-implementation", "package:reviewer"],
		["release candidate review", "package:reviewer"],
		["final check", "package:validator"],
		["package proof", "package:validator"],
		["docs review", "package:reviewer"],
		["docs clarity audit", "package:docs-auditor"],
		["public copy clarity", "package:docs-auditor"],
		["first-success docs", "package:docs-auditor"],
		["model-facing docs review", "package:docs-auditor"],
		["examples audit", "package:docs-auditor"],
		["documentation validation", "package:validator"],
		["release gate validation", "package:validator"],
		["adversarial release premortem", "package:critic"],
		["worker", "package:worker"],
		["implementation", "package:worker"],
		["fix bug", "package:worker"],
		["repair failing test", "package:worker"],
		["synthesizer", "package:synthesizer"],
		["synthesis", "package:synthesizer"],
		["fan-in", "package:synthesizer"],
		["handoff", "package:synthesizer"],
	]);
	for (const [query, ref] of expectations) {
		const refs = catalogAgents(discovery, query).map((agent) => agent.ref);
		assert.equal(refs[0], ref, `${query} should rank ${ref} first; got ${refs.join(", ")}`);
	}
});

test("catalogAgents keeps known excluded refs out of sparse top results", () => {
	const discovery = discoverAgents({ cwd: packageRoot, packageAgentsDir: join(packageRoot, "agents"), library: normalizeLibraryOptions({ sources: ["package"] }) });
	const cases = [
		{ query: "web research", top: "package:web-researcher", excluded: "package:scout" },
		{ query: "command proof", top: "package:validator", excluded: "package:reviewer" },
		{ query: "implementation", top: "package:worker", excluded: "package:docs-auditor" },
	] as const;
	for (const item of cases) {
		const refs = catalogAgents(discovery, item.query).map((agent) => agent.ref);
		assert.equal(refs[0], item.top, `${item.query} should rank ${item.top} first; got ${refs.join(", ")}`);
		assert.equal(refs.slice(0, 2).includes(item.excluded), false, `${item.query} should not include ${item.excluded} in top 2; got ${refs.join(", ")}`);
	}
});

test("catalogAgents filters by exact phrase or non-stopword query terms", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-catalog-"));
	const packageDir = join(root, "package-agents");
	await makeAgent(packageDir, "planner.md", "---\nname: planner\ndescription: creates implementation plans\n---\nPrompt");
	await makeAgent(packageDir, "reviewer.md", "---\nname: reviewer\ndescription: reviews tests\n---\nPrompt");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, library: normalizeLibraryOptions({ sources: ["package"], query: "test" }) });
	const catalog = catalogAgents(discovery, discovery.sources.length > 0 ? "test" : undefined);
	assert.deepEqual(catalog.map((agent) => agent.ref), ["package:reviewer"]);
	assert.equal(catalog[0].sha256.length, 64);
	const broadCatalog = catalogAgents(discovery, "plan and test").map((agent) => agent.ref);
	assert.deepEqual(broadCatalog, ["package:planner", "package:reviewer"]);
	await rm(root, { recursive: true, force: true });
});

test("catalogAgents does not match short query tokens as substrings of paths", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-catalog-substring-"));
	const packageDir = join(root, "examples", "agents");
	await makeAgent(packageDir, "worker.md", "---\nname: worker\ndescription: implements examples\n---\nPrompt");
	const discovery = discoverAgents({ cwd: root, packageAgentsDir: packageDir, library: normalizeLibraryOptions({ sources: ["package"] }) });
	assert.deepEqual(catalogAgents(discovery, "exa"), []);
	await rm(root, { recursive: true, force: true });
});
