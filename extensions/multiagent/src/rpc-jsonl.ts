/** Strict LF-delimited JSONL framing for Pi RPC child processes. */

import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";
import { RPC_RECORD_MAX_CHARS } from "./types.ts";

export type RpcJsonRecord = Record<string, unknown>;

export interface RpcJsonlReader {
	detach: () => void;
	end: () => void;
}

export function serializeRpcJsonLine(value: RpcJsonRecord): string {
	return `${JSON.stringify(value)}\n`;
}

export function attachRpcJsonlReader(stream: Readable, onRecord: (record: RpcJsonRecord) => void, onError: (message: string) => void, maxRecordChars = RPC_RECORD_MAX_CHARS): RpcJsonlReader {
	const decoder = new StringDecoder("utf8");
	let buffer = "";
	let failed = false;
	const fail = (message: string) => {
		if (failed) return;
		failed = true;
		onError(message);
	};
	const processLine = (line: string) => {
		if (failed) return;
		const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
		if (normalized.length > maxRecordChars) {
			fail(`RPC JSONL record exceeded ${maxRecordChars} characters.`);
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(normalized);
		} catch (error) {
			fail(`RPC JSONL parse failed: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		if (!isRecord(parsed)) {
			fail("RPC JSONL record must be a JSON object.");
			return;
		}
		onRecord(parsed);
	};
	const processBufferedLines = () => {
		let newline = buffer.indexOf("\n");
		while (newline !== -1) {
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			processLine(line);
			if (failed) return;
			newline = buffer.indexOf("\n");
		}
		if (buffer.length > maxRecordChars) fail(`RPC JSONL pending record exceeded ${maxRecordChars} characters.`);
	};
	const onData = (chunk: Buffer | string) => {
		if (failed) return;
		buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
		processBufferedLines();
	};
	const onEnd = () => {
		if (failed) return;
		buffer += decoder.end();
		processBufferedLines();
		if (!failed && buffer.length > 0) fail("RPC JSONL stream ended with an unterminated record.");
	};
	stream.on("data", onData);
	stream.on("end", onEnd);
	return {
		detach: () => {
			stream.off("data", onData);
			stream.off("end", onEnd);
		},
		end: onEnd,
	};
}

function isRecord(value: unknown): value is RpcJsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
