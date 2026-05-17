import assert from "node:assert/strict";
import { access, mkdir, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { cleanupRunArtifacts, createRunArtifactStore, recordRunArtifact, writeRunArtifact } from "../extensions/multiagent/src/background-artifacts.ts";
import { writePromptFile } from "../extensions/multiagent/src/delegated-prompt.ts";
import type { ResolvedAgent } from "../extensions/multiagent/src/types.ts";

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

test("writeRunArtifact rejects path-escaping artifact names", () => {
	const store = createRunArtifactStore();
	assert.throws(() => writeRunArtifact(store, "../escape.md", "bad", "x"), /basename/);
	cleanupRunArtifacts(store);
});

test("recordRunArtifact rejects outside paths before recording", async () => {
	const store = createRunArtifactStore();
	const outside = join(store.runDir, "..", `outside-${Date.now()}.md`);
	await writeFile(outside, "secret", "utf8");
	assert.throws(() => recordRunArtifact(store, outside, "bad"), /escaped/);
	assert.equal(store.records.length, 0);
	cleanupRunArtifacts(store);
	await unlink(outside);
});

test("cleanupRunArtifacts unlinks tampered symlinks and is idempotent", async () => {
	const store = createRunArtifactStore();
	const outside = join(store.runDir, "..", `outside-target-${Date.now()}.md`);
	await writeFile(outside, "keep", "utf8");
	const record = writeRunArtifact(store, "final.md", "final", "content");
	await unlink(record.path);
	await symlink(outside, record.path);
	const deleted = cleanupRunArtifacts(store);
	assert.equal(deleted.includes(record.path), true);
	assert.equal(await exists(store.runDir), false);
	assert.equal(await readFile(outside, "utf8"), "keep");
	assert.deepEqual(cleanupRunArtifacts(store), []);
	await unlink(outside);
});

test("manifest rewrite replaces manifest symlink without overwriting target", async () => {
	const store = createRunArtifactStore();
	const outside = join(store.runDir, "..", `outside-manifest-${Date.now()}.json`);
	await writeFile(outside, "keep", "utf8");
	await unlink(store.manifestPath);
	await symlink(outside, store.manifestPath);
	writeRunArtifact(store, "final.md", "final", "content");
	assert.equal(await readFile(outside, "utf8"), "keep");
	assert.match(await readFile(store.manifestPath, "utf8"), /final.md/);
	cleanupRunArtifacts(store);
	await unlink(outside);
});

test("artifact writes fail closed when run directory identity changes", async () => {
	const store = createRunArtifactStore();
	const originalRunDir = store.runDir;
	const archiveRunDir = join(dirname(originalRunDir), `archived-${Date.now()}`);
	const outsideDir = join(dirname(originalRunDir), `outside-dir-${Date.now()}`);
	await mkdir(outsideDir);
	await rename(originalRunDir, archiveRunDir);
	await symlink(outsideDir, originalRunDir);
	assert.throws(() => writeRunArtifact(store, "final.md", "final", "content"), /run directory/);
	assert.equal(await exists(join(outsideDir, "final.md")), false);
	assert.throws(() => cleanupRunArtifacts(store), /run directory/);
	await unlink(originalRunDir);
	await rename(archiveRunDir, originalRunDir);
	cleanupRunArtifacts(store);
	await rm(outsideDir, { recursive: true, force: true });
});

test("prompt writes use artifact ownership and refuse preexisting symlinks", async () => {
	const store = createRunArtifactStore();
	const outside = join(store.runDir, "..", `outside-prompt-${Date.now()}.md`);
	await writeFile(outside, "keep", "utf8");
	await symlink(outside, join(store.runDir, "one-system.md"));
	assert.throws(() => writePromptFile(agent(), store, "one"), /EEXIST|symbolic link|file already exists/i);
	assert.equal(await readFile(outside, "utf8"), "keep");
	await unlink(join(store.runDir, "one-system.md"));
	cleanupRunArtifacts(store);
	await unlink(outside);
});

test("child prompts require self-contained final answers", async () => {
	const store = createRunArtifactStore();
	const promptPath = writePromptFile(agent(), store, "one");
	const prompt = await readFile(promptPath, "utf8");
	assert.match(prompt, /self-contained final Markdown answer/);
	assert.match(prompt, /repeat substantive findings/);
	assert.match(prompt, /do not invent command proof/);
	assert.equal(prompt.lastIndexOf("Runtime reminder:") > prompt.lastIndexOf("Return ok."), true);
	cleanupRunArtifacts(store);
});

function agent(): ResolvedAgent {
	return { id: "one", ref: "inline:one", name: "one", kind: "inline", description: "one", tools: [], extensionTools: [], callerSkills: [], systemPrompt: "Return ok.", model: undefined, thinking: undefined, source: "inline", filePath: undefined, sha256: undefined };
}
