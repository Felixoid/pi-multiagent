import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { buildPiArgs, getPiInvocation, resolvePiCommandFromPath } from "../extensions/multiagent/src/child-launch.ts";
import type { ResolvedAgent } from "../extensions/multiagent/src/types.ts";

test("buildPiArgs prefers library agent model and thinking metadata over parent defaults", () => {
	const args = buildPiArgs({ ...resolvedAgent(), model: "provider/model", thinking: "high" }, { model: "parent/model", thinking: "off" }, "/tmp/prompt.md");
	assert.equal(args.includes("--model"), true);
	assert.equal(args[args.indexOf("--model") + 1], "provider/model");
	assert.equal(args.includes("--thinking"), true);
	assert.equal(args[args.indexOf("--thinking") + 1], "high");
});

test("buildPiArgs uses parent defaults when agent has no model metadata", () => {
	const args = buildPiArgs(resolvedAgent(), { model: "parent/model", thinking: "medium" }, "/tmp/prompt.md");
	assert.equal(args[args.indexOf("--model") + 1], "parent/model");
	assert.equal(args[args.indexOf("--thinking") + 1], "medium");
});

test("buildPiArgs rejects resolved agents missing mandatory read/discovery", () => {
	const agent = { ...resolvedAgent(), tools: [] };
	assert.throws(() => buildPiArgs(agent, { model: undefined, thinking: undefined }, "/tmp/prompt.md"), /mandatory read\/discovery/);
});

test("buildPiArgs keeps normal extension discovery and loads explicit extension grants additively", () => {
	const agent = { ...resolvedAgent(), extensionTools: [{ name: "exa_search", description: "Search", source: { path: "/tmp/extension.ts", realpath: "/tmp/extension.ts", source: "user:exa", scope: "user", origin: "package", baseDir: undefined, dev: 1, ino: 2, size: 3, mtimeMs: 4, sha256: "abc" } }] };
	const args = buildPiArgs(agent, { model: undefined, thinking: undefined }, "/tmp/prompt.md");
	assert.equal(args.includes("--no-extensions"), false);
	assert.equal(args[args.indexOf("--extension") + 1], "/tmp/extension.ts");
	assert.equal(args[args.indexOf("--tools") + 1], "read,grep,find,ls,exa_search");
});

test("buildPiArgs launches only explicitly selected caller skills", () => {
	const agent = { ...resolvedAgent(), callerSkills: [
		{ name: "one", description: "One", source: { path: "/tmp/one/SKILL.md", realpath: "/tmp/one/SKILL.md", source: "user:one", scope: "user", origin: "top-level", baseDir: "/tmp", dev: 1, ino: 2, size: 3, mtimeMs: 4, sha256: "one" } },
		{ name: "one-copy", description: "One copy", source: { path: "/tmp/one/SKILL.md", realpath: "/tmp/one/SKILL.md", source: "user:one-copy", scope: "user", origin: "top-level", baseDir: "/tmp", dev: 1, ino: 2, size: 3, mtimeMs: 4, sha256: "one" } },
		{ name: "two", description: "Two", source: { path: "/tmp/two/SKILL.md", realpath: "/tmp/two/SKILL.md", source: "user:two", scope: "user", origin: "top-level", baseDir: "/tmp", dev: 5, ino: 6, size: 7, mtimeMs: 8, sha256: "two" } },
	] };
	const args = buildPiArgs(agent, { model: undefined, thinking: undefined }, "/tmp/prompt.md");
	assert.equal(args.includes("--no-skills"), true);
	assert.deepEqual(args.filter((value) => value === "--skill"), ["--skill", "--skill"]);
	assert.equal(args[args.indexOf("--skill") + 1], "/tmp/one/SKILL.md");
	assert.equal(args[args.lastIndexOf("--skill") + 1], "/tmp/two/SKILL.md");
	assert.equal(args[args.indexOf("--tools") + 1], "read,grep,find,ls");
});

test("resolvePiCommandFromPath ignores empty and relative PATH entries", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-launch-"));
	const bin = join(root, "bin");
	await mkdir(bin);
	const launcher = join(bin, process.platform === "win32" ? "pi.cmd" : "pi");
	await writeFile(launcher, "#!/bin/sh\nexit 0\n", "utf8");
	await chmod(launcher, 0o755);
	try {
		assert.equal(resolvePiCommandFromPath(`:relative:${bin}`, process.cwd()), launcher);
		assert.equal(resolvePiCommandFromPath(":relative", process.cwd()), undefined);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("resolvePiCommandFromPath skips launchers inside delegated project root", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-launch-deny-"));
	const projectBin = join(root, "project", "bin");
	const trustedBin = join(root, "trusted");
	await mkdir(projectBin, { recursive: true });
	await mkdir(trustedBin);
	await mkdir(join(root, "project", ".pi"));
	const launcherName = process.platform === "win32" ? "pi.cmd" : "pi";
	const projectLauncher = join(projectBin, launcherName);
	const trustedLauncher = join(trustedBin, launcherName);
	await writeFile(projectLauncher, "#!/bin/sh\nexit 1\n", "utf8");
	await writeFile(trustedLauncher, "#!/bin/sh\nexit 0\n", "utf8");
	await chmod(projectLauncher, 0o755);
	await chmod(trustedLauncher, 0o755);
	try {
		assert.equal(resolvePiCommandFromPath(`${projectBin}:${trustedBin}`, join(root, "project")), trustedLauncher);
		assert.equal(resolvePiCommandFromPath(`${projectBin}:${trustedBin}`, join(root, "project", ".")), trustedLauncher);
		assert.equal(resolvePiCommandFromPath(`${projectBin}:${trustedBin}`, `${join(root, "project")}/`), trustedLauncher);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("resolvePiCommandFromPath treats dangling project marker symlinks as denied roots", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-launch-dangling-marker-"));
	const project = join(root, "project");
	const projectBin = join(project, "bin");
	const trustedBin = join(root, "trusted");
	await mkdir(projectBin, { recursive: true });
	await mkdir(trustedBin);
	await symlink(join(root, "missing-git-target"), join(project, ".git"));
	const launcherName = process.platform === "win32" ? "pi.cmd" : "pi";
	const projectLauncher = join(projectBin, launcherName);
	const trustedLauncher = join(trustedBin, launcherName);
	await writeFile(projectLauncher, "#!/bin/sh\nexit 1\n", "utf8");
	await writeFile(trustedLauncher, "#!/bin/sh\nexit 0\n", "utf8");
	await chmod(projectLauncher, 0o755);
	await chmod(trustedLauncher, 0o755);
	try {
		assert.equal(resolvePiCommandFromPath(`${projectBin}:${trustedBin}`, join(project, "src")), trustedLauncher);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("resolvePiCommandFromPath skips realpath project launchers", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-launch-realpath-"));
	const project = join(root, "project");
	const projectBin = join(project, "bin");
	const trustedBin = join(root, "trusted");
	const linkedProject = join(root, "linked-project");
	const linkedBin = join(root, "linked-bin");
	await mkdir(projectBin, { recursive: true });
	await mkdir(trustedBin);
	await mkdir(join(project, ".pi"));
	await symlink(project, linkedProject, "dir");
	await symlink(projectBin, linkedBin, "dir");
	const launcherName = process.platform === "win32" ? "pi.cmd" : "pi";
	const projectLauncher = join(projectBin, launcherName);
	const trustedLauncher = join(trustedBin, launcherName);
	await writeFile(projectLauncher, "#!/bin/sh\nexit 1\n", "utf8");
	await writeFile(trustedLauncher, "#!/bin/sh\nexit 0\n", "utf8");
	await chmod(projectLauncher, 0o755);
	await chmod(trustedLauncher, 0o755);
	try {
		assert.equal(resolvePiCommandFromPath(`${linkedBin}:${trustedBin}`, linkedProject), trustedLauncher);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("getPiInvocation refuses current script or executable inside delegated project root", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-launch-current-deny-"));
	const project = join(root, "project");
	const trustedBin = join(root, "trusted");
	await mkdir(project, { recursive: true });
	await mkdir(trustedBin);
	await mkdir(join(project, ".pi"));
	const launcherName = process.platform === "win32" ? "pi.cmd" : "pi";
	const trustedLauncher = join(trustedBin, launcherName);
	const projectScript = join(project, "pi-entry.js");
	const projectNative = join(project, "pi-native");
	await writeFile(trustedLauncher, "#!/bin/sh\nexit 0\n", "utf8");
	await writeFile(projectScript, "", "utf8");
	await writeFile(projectNative, "#!/bin/sh\nexit 1\n", "utf8");
	await chmod(trustedLauncher, 0o755);
	await chmod(projectNative, 0o755);
	const originalPath = process.env.PATH;
	const originalScript = process.argv[1];
	const originalExecPath = Object.getOwnPropertyDescriptor(process, "execPath");
	try {
		process.env.PATH = trustedBin;
		process.argv[1] = projectScript;
		const scriptInvocation = getPiInvocation(["--mode", "json"], project);
		assert.equal(scriptInvocation.command, trustedLauncher);
		Object.defineProperty(process, "execPath", { value: projectNative, configurable: true, enumerable: true, writable: true });
		process.argv[1] = "";
		const nativeInvocation = getPiInvocation(["--mode", "json"], project);
		assert.equal(nativeInvocation.command, trustedLauncher);
	} finally {
		if (originalPath === undefined) delete process.env.PATH;
		else process.env.PATH = originalPath;
		process.argv[1] = originalScript;
		if (originalExecPath) Object.defineProperty(process, "execPath", originalExecPath);
		await rm(root, { recursive: true, force: true });
	}
});

test("getPiInvocation falls back to PATH when current execPath disappeared", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-launch-missing-exec-"));
	const project = join(root, "project");
	const trustedBin = join(root, "trusted");
	const scriptRoot = join(root, "script-root");
	await mkdir(project);
	await mkdir(trustedBin);
	await mkdir(scriptRoot);
	const launcherName = process.platform === "win32" ? "pi.cmd" : "pi";
	const trustedLauncher = join(trustedBin, launcherName);
	const currentScript = join(scriptRoot, "pi-entry.js");
	const missingNode = join(root, "missing-node");
	await writeFile(trustedLauncher, "#!/bin/sh\nexit 0\n", "utf8");
	await writeFile(currentScript, "", "utf8");
	await chmod(trustedLauncher, 0o755);
	const originalPath = process.env.PATH;
	const originalScript = process.argv[1];
	const originalExecPath = Object.getOwnPropertyDescriptor(process, "execPath");
	try {
		process.env.PATH = trustedBin;
		process.argv[1] = currentScript;
		Object.defineProperty(process, "execPath", { value: missingNode, configurable: true, enumerable: true, writable: true });
		const invocation = getPiInvocation(["--mode", "json"], project);
		assert.equal(invocation.command, trustedLauncher);
		assert.deepEqual(invocation.args, ["--mode", "json"]);
	} finally {
		if (originalPath === undefined) delete process.env.PATH;
		else process.env.PATH = originalPath;
		process.argv[1] = originalScript;
		if (originalExecPath) Object.defineProperty(process, "execPath", originalExecPath);
		await rm(root, { recursive: true, force: true });
	}
});

function resolvedAgent(): ResolvedAgent {
	return { id: "one", ref: "package:critic", name: "critic", kind: "library", description: "Critic", tools: ["read", "grep", "find", "ls"], extensionTools: [], callerSkills: [], systemPrompt: "Review.", model: undefined, thinking: undefined, source: "package", filePath: "/tmp/critic.md", sha256: "abc" };
}

test("getPiInvocation resolves relative current script before delegated cwd spawn", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-multiagent-launch-script-cwd-"));
	const scriptRoot = await mkdtemp(join(tmpdir(), "pi-multiagent-launch-script-entry-"));
	const script = join(scriptRoot, "pi-entry.js");
	const originalScript = process.argv[1];
	await writeFile(script, "", "utf8");
	try {
		process.argv[1] = relative(process.cwd(), script);
		const invocation = getPiInvocation(["--mode", "json"], root);
		assert.equal(invocation.command, process.execPath);
		assert.equal(invocation.args[0], resolve(process.argv[1]));
	} finally {
		process.argv[1] = originalScript;
		await rm(root, { recursive: true, force: true });
		await rm(scriptRoot, { recursive: true, force: true });
	}
});
