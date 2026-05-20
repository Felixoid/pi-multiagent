import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerMultiagentExtension } from "../extensions/multiagent/index.ts";
import type { SpawnOptions } from "../extensions/multiagent/src/child-launch.ts";
import type { AgentTeamDetails } from "../extensions/multiagent/src/types.ts";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

interface RegisteredTool {
	name: string;
	execute: (toolCallId: string, params: object, signal: AbortSignal | undefined, onUpdate: unknown, ctx: ExtensionCtx) => Promise<{ content: { type: string; text: string }[]; details: AgentTeamDetails }>;
}

interface ExtensionCtx {
	cwd: string;
	hasUI: boolean;
	model: undefined;
	ui: {
		confirm: () => Promise<boolean>;
		setWidget: (id: string, value: unknown) => void;
		setStatus: (id: string, value: string | undefined) => void;
	};
}

type ShutdownHandler = (event: { reason?: string }) => void;

class FakeChild extends EventEmitter {
	stdin = new PassThrough();
	stdout = new PassThrough();
	stderr = new PassThrough();
	exitCode: number | null = null;
	pid: number | undefined = undefined;
	onKill: (() => void) | undefined;

	kill(): boolean {
		this.onKill?.();
		return true;
	}

	close(code: number): void {
		this.exitCode = code;
		this.emit("close", code, null);
		this.stdout.end();
		this.stderr.end();
	}
}

const tools: RegisteredTool[] = [];
const customMessages: { message: unknown; options: unknown }[] = [];
const statusValues: (string | undefined)[] = [];
const widgetValues: unknown[] = [];
const tasks: string[] = [];
const shutdownHandlers: ShutdownHandler[] = [];

registerMultiagentExtension(
	{
		on(eventName: string, handler: ShutdownHandler) {
			if (eventName === "session_shutdown") shutdownHandlers.push(handler);
		},
		registerMessageRenderer() {},
		registerTool(tool: RegisteredTool) {
			tools.push(tool);
		},
		sendMessage(message: unknown, options: unknown) {
			customMessages.push({ message, options });
		},
		getThinkingLevel() {
			return undefined;
		},
		getActiveTools() {
			return [];
		},
		getAllTools() {
			return [];
		},
		getCommands() {
			return [];
		},
	},
	{ spawnProcess },
);

const tool = tools.find((candidate) => candidate.name === "agent_team");
assert.ok(tool);

const catalog = await tool.execute("smoke-catalog", { action: "catalog", library: { sources: ["package"], query: "review" } }, undefined, undefined, makeCtx(false));
assert.equal(catalog.content[0].text.includes("package:reviewer"), true);

const invalidCatalogControl = await tool.execute("smoke-invalid-catalog-control", { action: "catalog", maxBytes: 1000 }, undefined, undefined, makeCtx(false));
assert.equal(invalidCatalogControl.content[0].text.startsWith("# agent_team error"), true);
assert.match(invalidCatalogControl.content[0].text, /library\.query/);
assert.doesNotMatch(invalidCatalogControl.content[0].text, /^# agent_team catalog/);

let confirmed = false;
const invalidRun = await tool.execute("smoke-invalid-run", { action: "run" }, undefined, undefined, makeCtx(true, () => {
	confirmed = true;
	return Promise.resolve(true);
}));
assert.equal(confirmed, false);
assert.equal(invalidRun.content[0].text.startsWith("# agent_team error"), true);
assert.equal(invalidRun.content[0].text.includes("action-invalid"), true);

const started = await tool.execute(
	"smoke-start",
	{ action: "start", graph: { objective: "smoke run", authority: { allowFilesystemRead: true }, steps: [{ id: "step", agent: { system: "Return smoke-ok." }, task: "smoke task" }], limits: { timeoutSecondsPerStep: 30 } }, options: { terminalRetentionSeconds: 30, notify: { mode: "milestones", minIntervalSeconds: 0 } } },
	undefined,
	undefined,
	makeCtx(true),
);
const runId = started.details.run?.runId ?? "";
assert.match(runId, /^agt_/);
assert.equal(started.details.run?.terminal, false);

let terminal = await tool.execute("smoke-run_status-0", { action: "run_status", runId, preview: true }, undefined, undefined, makeCtx(true));
for (let attempt = 0; !terminal.details.run?.terminal && attempt < 20; attempt += 1) {
	await new Promise((resolve) => setTimeout(resolve, 5));
	terminal = await tool.execute(`smoke-run_status-${attempt + 1}`, { action: "run_status", runId, cursor: terminal.details.cursor, preview: true }, undefined, undefined, makeCtx(true));
}
assert.equal(terminal.details.run?.status, "succeeded");
assert.equal(terminal.details.steps[0]?.status, "succeeded");
assert.equal(terminal.details.events.length, 0);
assert.equal(terminal.details.outputs[0]?.filePath !== undefined, true);
assert.equal(terminal.content[0].text.includes("smoke-ok"), true);

const step_result = await tool.execute("smoke-step_result", { action: "step_result", runId, stepId: "step", preview: true }, undefined, undefined, makeCtx(true));
assert.equal(step_result.details.outputs[0]?.text, "smoke-ok");
assert.equal(tasks[0]?.includes("smoke task"), true);
assert.equal(customMessages.length, 1);
assertNotice(customMessages[0]);
assert.equal(statusValues.includes("1 lane"), true);
assert.equal(statusValues.at(-1), undefined);
assert.equal(widgetValues.some((value) => value !== undefined), true);

const cleanup = await tool.execute("smoke-cleanup", { action: "cleanup", runId }, undefined, undefined, makeCtx(true));
assert.equal(cleanup.details.cleanup?.runId, runId);

const graphFileRoot = await mkdir(join(tmpdir(), `pi-multiagent-smoke-graph-file-${Date.now()}`), { recursive: true });
await writeFile(join(graphFileRoot, "graph.json"), JSON.stringify({ objective: "smoke graphFile", authority: { allowFilesystemRead: true }, steps: [{ id: "from-file", agent: { system: "Return smoke-ok." }, task: "graph file task" }], limits: { timeoutSecondsPerStep: 30 } }));
const graphFileStarted = await tool.execute("smoke-graph-file-start", { action: "start", graphFile: "graph.json", options: { terminalRetentionSeconds: 30, notify: { mode: "none" } } }, undefined, undefined, makeCtx(true, async () => false, graphFileRoot));
const graphFileRunId = graphFileStarted.details.run?.runId ?? "";
assert.match(graphFileRunId, /^agt_/);
let graphFileTerminal = await tool.execute("smoke-graph-file-run_status-0", { action: "run_status", runId: graphFileRunId, preview: true }, undefined, undefined, makeCtx(true, async () => false, graphFileRoot));
for (let attempt = 0; !graphFileTerminal.details.run?.terminal && attempt < 20; attempt += 1) {
	await new Promise((resolve) => setTimeout(resolve, 5));
	graphFileTerminal = await tool.execute(`smoke-graph-file-run_status-${attempt + 1}`, { action: "run_status", runId: graphFileRunId, cursor: graphFileTerminal.details.cursor, preview: true }, undefined, undefined, makeCtx(true, async () => false, graphFileRoot));
}
assert.equal(graphFileTerminal.details.run?.status, "succeeded");
assert.equal(graphFileTerminal.details.outputs[0]?.text, "smoke-ok");
const graphFileCleanup = await tool.execute("smoke-graph-file-cleanup", { action: "cleanup", runId: graphFileRunId }, undefined, undefined, makeCtx(true, async () => false, graphFileRoot));
assert.equal(graphFileCleanup.details.cleanup?.runId, graphFileRunId);
await rm(graphFileRoot, { recursive: true, force: true });

const holdStarted = await tool.execute(
	"smoke-start-hold",
	{ action: "start", graph: { objective: "shutdown smoke", authority: { allowFilesystemRead: true }, steps: [{ id: "hold", agent: { system: "Wait until canceled." }, task: "hold task" }], limits: { timeoutSecondsPerStep: 30 } }, options: { terminalRetentionSeconds: 30, notify: { mode: "none" } } },
	undefined,
	undefined,
	makeCtx(true),
);
const holdRunId = holdStarted.details.run?.runId ?? "";
assert.match(holdRunId, /^agt_/);
assert.equal(holdStarted.details.run?.status, "running");
assert.equal(shutdownHandlers.length, 1);
shutdownHandlers[0]({ reason: "smoke reload" });
let canceled = await tool.execute("smoke-run_status-hold-0", { action: "run_status", runId: holdRunId }, undefined, undefined, makeCtx(true));
for (let attempt = 0; !canceled.details.run?.terminal && attempt < 20; attempt += 1) {
	await new Promise((resolve) => setTimeout(resolve, 5));
	canceled = await tool.execute(`smoke-run_status-hold-${attempt + 1}`, { action: "run_status", runId: holdRunId, cursor: canceled.details.cursor }, undefined, undefined, makeCtx(true));
}
assert.equal(canceled.details.run?.status, "canceled");
assert.equal(canceled.details.steps[0]?.errorMessage?.includes("smoke reload"), true);
const holdCleanup = await tool.execute("smoke-cleanup-hold", { action: "cleanup", runId: holdRunId }, undefined, undefined, makeCtx(true));
assert.equal(holdCleanup.details.cleanup?.runId, holdRunId);

function spawnProcess(_command: string, args: string[], spawnOptions: SpawnOptions): ChildProcessWithoutNullStreams {
	assert.equal(args.includes("smoke task"), false);
	assert.equal(spawnOptions.shell, false);
	assert.deepEqual(spawnOptions.stdio, ["pipe", "pipe", "pipe"]);
	assert.equal(args.includes("--mode"), true);
	assert.equal(args.includes("rpc"), true);
	assert.equal(args.includes("--no-session"), true);
	assert.equal(args.includes("--no-extensions"), false);
	assert.equal(args.includes("--no-context-files"), true);
	const child = new FakeChild();
	child.onKill = () => child.close(0);
	let buffer = "";
	child.stdin.on("data", (chunk: Buffer) => {
		buffer += chunk.toString("utf8");
		let newline = buffer.indexOf("\n");
		while (newline !== -1) {
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			const command = JSON.parse(line) as { id: string; type: string; message?: string };
			if (command.message) tasks.push(command.message);
			child.stdout.write(`${JSON.stringify({ type: "response", id: command.id, command: command.type, success: true })}\n`);
			if (command.type === "prompt" && command.message?.includes("hold task") !== true) {
				child.stdout.write(`${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "smoke-ok" }] } })}\n`);
				child.stdout.write(`${JSON.stringify({ type: "agent_end", messages: [] })}\n`);
				child.close(0);
			}
			newline = buffer.indexOf("\n");
		}
	});
	return child as unknown as ChildProcessWithoutNullStreams;
}

function makeCtx(hasUI: boolean, confirm: () => Promise<boolean> = async () => false, cwd = packageRoot): ExtensionCtx {
	return {
		cwd,
		hasUI,
		model: undefined,
		ui: {
			confirm,
			setWidget(_id, value) {
				widgetValues.push(value);
			},
			setStatus(_id, value) {
				statusValues.push(value);
			},
		},
	};
}

function assertNotice(notice: { message: unknown; options: unknown } | undefined): void {
	assert.ok(notice);
	assert.equal(isRecord(notice.options), true);
	assert.equal(notice.options.deliverAs, "steer");
	assert.equal(notice.options.triggerTurn, true);
	assert.equal(isRecord(notice.message), true);
	assert.equal(notice.message.customType, "agent_team.notice");
	assert.equal(notice.message.display, true);
	assert.equal(typeof notice.message.content, "string");
	assert.match(notice.message.content, /agent_team succeeded smoke run/);
	assert.match(notice.message.content, /runId=agt_/);
	assert.match(notice.message.content, /final evidence step succeeded .*\.md/);
	assert.match(notice.message.content, /untrusted status evidence; run_status\/step_result for artifacts/);
	assert.doesNotMatch(notice.message.content, /# agent_team terminal notice|Objective:|Run:|Exceptional controls|artifact=|\/tmp\/|Next:|cleanup|cursor|debugEvents|smoke-ok/i);
	assert.equal(isRecord(notice.message.details), true);
	const details = notice.message.details;
	const outputs = Array.isArray(details.outputs) ? details.outputs : [];
	const firstOutput = outputs.find(isRecord);
	assert.ok(firstOutput);
	assert.equal(firstOutput.text, undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
