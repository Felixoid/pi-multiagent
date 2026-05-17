import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { findNearestProjectDir, findNearestProjectMarker, findNearestProjectRoot, findNearestWorkspaceRoot } from "../extensions/multiagent/src/project-root.ts";

test("project root detection ignores the configured global Pi directory", async () => {
	const root = await mkdir(join(tmpdir(), `pi-multiagent-project-root-${Date.now()}`), { recursive: true });
	const globalPi = join(root, ".pi");
	const workspace = join(root, "Code", "repo");
	await mkdir(globalPi, { recursive: true });
	await mkdir(workspace, { recursive: true });
	await writeFile(join(globalPi, "settings.json"), "{}", "utf8");
	assert.equal(findNearestProjectDir(workspace, ".pi", globalPi), undefined);
	assert.equal(findNearestProjectMarker(workspace, ".pi", globalPi), undefined);
	assert.equal(findNearestProjectRoot(workspace, globalPi), undefined);
	assert.equal(findNearestWorkspaceRoot(workspace, globalPi), resolve(workspace));
	await mkdir(join(workspace, ".git"));
	assert.equal(findNearestProjectRoot(join(workspace, "src"), globalPi), resolve(workspace));
	await rm(root, { recursive: true, force: true });
});

test("project root detection accepts non-global project Pi markers", async () => {
	const root = await mkdir(join(tmpdir(), `pi-multiagent-local-pi-root-${Date.now()}`), { recursive: true });
	const globalPi = join(root, "home", ".pi");
	const workspace = join(root, "workspace");
	const nested = join(workspace, "src");
	await mkdir(globalPi, { recursive: true });
	await mkdir(join(workspace, ".pi"), { recursive: true });
	await mkdir(nested, { recursive: true });
	assert.equal(findNearestProjectDir(nested, ".pi", globalPi), join(workspace, ".pi"));
	assert.equal(findNearestProjectMarker(nested, ".pi", globalPi), join(workspace, ".pi"));
	assert.equal(findNearestProjectRoot(nested, globalPi), resolve(workspace));
	assert.equal(findNearestWorkspaceRoot(nested, globalPi), resolve(workspace));
	await rm(root, { recursive: true, force: true });
});
