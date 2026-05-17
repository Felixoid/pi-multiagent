import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const enabled = process.env.PI_MULTIAGENT_REAL_SMOKE === "1";
const piCommand = process.env.PI_MULTIAGENT_PI_COMMAND ?? "pi";
const timeoutMs = Number(process.env.PI_MULTIAGENT_REAL_SMOKE_TIMEOUT_MS ?? "120000");
const sigkillGraceMs = 5_000;
const closeFallbackMs = timeoutMs + sigkillGraceMs + 5_000;
const expectedFinal = "pi-multiagent-real-smoke-ok";

if (!enabled) {
	throw new Error("Real Pi smoke is opt-in because it launches the installed Pi runtime and may call the configured model. Run PI_MULTIAGENT_REAL_SMOKE=1 pnpm run smoke:pi when preparing a release candidate.");
}

interface SmokeState {
	promptAccepted: boolean;
	agentTeamToolFinished: boolean;
	agentTeamToolSucceeded: boolean;
	agentTeamCatalogContainedReviewer: boolean;
	assistantConfirmed: boolean;
	agentEnded: boolean;
	assistantFinalText: string | undefined;
	toolResultPreview: string | undefined;
}

interface SmokeExit {
	code: number | null;
	signal: NodeJS.Signals | null;
	timedOut: boolean;
}

const child = spawn(piCommand, ["--mode", "rpc", "--no-session", "-e", packageRoot], { stdio: ["pipe", "pipe", "pipe"] });
let stdoutBuffer = "";
let stderrText = "";
let stdinClosed = false;
let timeoutTriggered = false;
let sigkillTimer: ReturnType<typeof setTimeout> | undefined;
const state: SmokeState = { promptAccepted: false, agentTeamToolFinished: false, agentTeamToolSucceeded: false, agentTeamCatalogContainedReviewer: false, assistantConfirmed: false, agentEnded: false, assistantFinalText: undefined, toolResultPreview: undefined };

const timeout = setTimeout(() => {
	timeoutTriggered = true;
	child.kill("SIGTERM");
	sigkillTimer = setTimeout(() => child.kill("SIGKILL"), sigkillGraceMs);
	sigkillTimer.unref?.();
}, timeoutMs);
timeout.unref();

child.stderr.on("data", (chunk: Buffer | string) => {
	stderrText += typeof chunk === "string" ? chunk : chunk.toString("utf8");
});

child.stdout.on("data", (chunk: Buffer | string) => {
	stdoutBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
	let newline = stdoutBuffer.indexOf("\n");
	while (newline !== -1) {
		const line = stdoutBuffer.slice(0, newline);
		stdoutBuffer = stdoutBuffer.slice(newline + 1);
		handleRecord(line);
		newline = stdoutBuffer.indexOf("\n");
	}
});

const prompt = [
	"This is the pi-multiagent release-candidate real runtime smoke.",
	"Use the agent_team tool exactly once with input {\"action\":\"catalog\",\"library\":{\"sources\":[\"package\"],\"query\":\"review\"}}.",
	"After the tool result shows package:reviewer, reply with exactly: pi-multiagent-real-smoke-ok",
].join("\n");

child.stdin.write(`${JSON.stringify({ id: "smoke-prompt", type: "prompt", message: prompt })}\n`);

const exit = await waitForExit();
clearTimeout(timeout);
if (sigkillTimer) clearTimeout(sigkillTimer);

assert.equal(exit.timedOut, false, `Pi real smoke timed out after ${timeoutMs}ms and did not close after SIGTERM/SIGKILL grace. stderr:\n${stderrText}`);
assert.equal(exit.signal, null, `Pi real smoke was killed or timed out after ${timeoutMs}ms. stderr:\n${stderrText}`);
assert.equal(exit.code, 0, `Pi real smoke exited non-zero. stderr:\n${stderrText}`);
assert.equal(state.promptAccepted, true, `prompt was not accepted. stderr:\n${stderrText}`);
assert.equal(state.agentTeamToolFinished, true, "agent_team tool did not complete in the real Pi run.");
assert.equal(state.agentTeamToolSucceeded, true, `agent_team tool completed with isError=true. result preview:\n${state.toolResultPreview ?? ""}`);
assert.equal(state.agentTeamCatalogContainedReviewer, true, `agent_team catalog result did not contain package:reviewer. result preview:\n${state.toolResultPreview ?? ""}`);
assert.equal(state.assistantConfirmed, true, `assistant final was not exactly ${expectedFinal}; got ${JSON.stringify(state.assistantFinalText)}.`);
assert.equal(state.agentEnded, true, "agent_end was not observed.");

async function waitForExit(): Promise<SmokeExit> {
	return await new Promise<SmokeExit>((resolve) => {
		const closeFallback = setTimeout(() => {
			child.stdin.destroy();
			child.stdout.destroy();
			child.stderr.destroy();
			child.unref();
			resolve({ code: null, signal: null, timedOut: true });
		}, closeFallbackMs);
		closeFallback.unref?.();
		child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
			clearTimeout(closeFallback);
			resolve({ code, signal, timedOut: timeoutTriggered });
		});
	});
}

function handleRecord(line: string): void {
	if (line.trim().length === 0) return;
	const record = parseRecord(line);
	if (!record) return;
	const type = stringField(record.type);
	if (type === "response" && record.id === "smoke-prompt" && stringField(record.command) === "prompt" && record.success === true) state.promptAccepted = true;
	if (type === "tool_execution_end" && stringField(record.toolName) === "agent_team") {
		state.agentTeamToolFinished = true;
		state.agentTeamToolSucceeded = record.isError !== true;
		const resultText = extractToolResultText(record);
		state.toolResultPreview = resultText.slice(0, 2_000);
		state.agentTeamCatalogContainedReviewer = resultText.includes("# agent_team catalog") && resultText.includes("package:reviewer");
	}
	if (type === "message_end") {
		const text = extractAssistantMessageText(record);
		if (text !== undefined) {
			state.assistantFinalText = text;
			state.assistantConfirmed = text === expectedFinal;
		}
	}
	if (type === "agent_end") {
		state.agentEnded = true;
		closeInputAfterTerminalEvent();
	}
}

function closeInputAfterTerminalEvent(): void {
	if (stdinClosed) return;
	stdinClosed = true;
	child.stdin.end();
}

function parseRecord(line: string): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = JSON.parse(line);
		return isRecord(parsed) ? parsed : undefined;
	} catch (error) {
		throw new Error(`Invalid RPC JSONL record: ${error instanceof Error ? error.message : String(error)}\n${line}`);
	}
}

function extractToolResultText(record: Record<string, unknown>): string {
	const result = isRecord(record.result) ? record.result : undefined;
	return extractTextContent(result).join("\n");
}

function extractAssistantMessageText(record: Record<string, unknown>): string | undefined {
	const message = isRecord(record.message) ? record.message : undefined;
	if (message?.role !== "assistant") return undefined;
	const parts = extractTextContent(message);
	return parts.length > 0 ? parts.join("") : undefined;
}

function extractTextContent(record: Record<string, unknown> | undefined): string[] {
	if (!record || !Array.isArray(record.content)) return [];
	const parts: string[] = [];
	for (const block of record.content) {
		if (isRecord(block) && block.type === "text" && typeof block.text === "string") parts.push(block.text);
	}
	return parts;
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
