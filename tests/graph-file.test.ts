import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { materializeAgentTeamInput } from "../extensions/multiagent/src/graph-file.ts";
import { MAX_GRAPH_FILE_BYTES } from "../extensions/multiagent/src/types.ts";

const graph = { objective: "from file", steps: [{ id: "one", agent: { system: "Return ok." }, task: "Return ok." }] };

test("materializeAgentTeamInput denies malformed graphFile without throwing", async () => {
	const root = await mkdir(join(tmpdir(), `pi-multiagent-graph-malformed-${Date.now()}`), { recursive: true });
	const result = materializeAgentTeamInput({ action: "start", graphFile: 42 }, root);
	assert.equal(result.diagnostics.some((item) => item.code === "graph-file-required"), true);
});

test("materializeAgentTeamInput loads a pure detached graph file for start", async () => {
	const root = await mkdir(join(tmpdir(), `pi-multiagent-graph-${Date.now()}`), { recursive: true });
	await writeFile(join(root, "graph.json"), JSON.stringify(graph));
	const result = materializeAgentTeamInput({ action: "start", graphFile: "graph.json" }, root);
	assert.equal(result.diagnostics.length, 0);
	assert.deepEqual(result.input.graph, graph);
	assert.equal(result.input.graphFile, undefined);
});

test("materializeAgentTeamInput rejects oversized graph files", async () => {
	const root = await mkdir(join(tmpdir(), `pi-multiagent-graph-large-${Date.now()}`), { recursive: true });
	await writeFile(join(root, "large.json"), "{" + " ".repeat(MAX_GRAPH_FILE_BYTES) + "}");
	const result = materializeAgentTeamInput({ action: "start", graphFile: "large.json" }, root);
	assert.equal(result.diagnostics.some((item) => item.code === "graph-file-too-large"), true);
});

test("materializeAgentTeamInput rejects non-start, mixed, and control-field graph files", async () => {
	const root = await mkdir(join(tmpdir(), `pi-multiagent-graph-deny-${Date.now()}`), { recursive: true });
	await writeFile(join(root, "graph.json"), JSON.stringify({ action: "start", ...graph }));
	assert.equal(materializeAgentTeamInput({ action: "run_status", runId: "r1", graphFile: "graph.json" }, root).diagnostics.some((item) => item.code === "graph-file-start-only"), true);
	assert.equal(materializeAgentTeamInput({ action: "start", graph, graphFile: "graph.json" }, root).diagnostics.some((item) => item.code === "graph-file-inline-graph-denied"), true);
	assert.equal(materializeAgentTeamInput({ action: "start", graphFile: "graph.json" }, root).diagnostics.some((item) => item.code === "graph-file-control-fields-denied"), true);
});

test("materializeAgentTeamInput rejects path escapes and symlinks before outside probing", async () => {
	const parent = await mkdir(join(tmpdir(), `pi-multiagent-graph-path-${Date.now()}`), { recursive: true });
	const root = await mkdir(join(parent, "root"), { recursive: true });
	const outside = await mkdir(join(parent, "outside"), { recursive: true });
	await writeFile(join(outside, "graph.json"), JSON.stringify(graph));
	await symlink(join(outside, "graph.json"), join(root, "link.json"));
	await symlink(outside, join(root, "link-dir"));
	assert.equal(materializeAgentTeamInput({ action: "start", graphFile: "../outside/graph.json" }, root).diagnostics.some((item) => item.code === "graph-file-path-escape-denied"), true);
	assert.equal(materializeAgentTeamInput({ action: "start", graphFile: "link.json" }, root).diagnostics.some((item) => item.code === "graph-file-symlink-denied"), true);
	assert.equal(materializeAgentTeamInput({ action: "start", graphFile: "link-dir/graph.json" }, root).diagnostics.some((item) => item.code === "graph-file-symlink-denied"), true);
});

test("materializeAgentTeamInput schema-validates graph file contents", async () => {
	const root = await mkdir(join(tmpdir(), `pi-multiagent-graph-schema-${Date.now()}`), { recursive: true });
	await writeFile(join(root, "bad.json"), JSON.stringify({ objective: "bad", steps: [{ id: "bad_id", agent: { system: "x" }, task: "x" }] }));
	const result = materializeAgentTeamInput({ action: "start", graphFile: "bad.json" }, root);
	assert.equal(result.diagnostics.some((item) => item.code === "graph-file-schema-invalid"), true);
});
