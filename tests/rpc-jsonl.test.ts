import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { attachRpcJsonlReader, serializeRpcJsonLine } from "../extensions/multiagent/src/rpc-jsonl.ts";

test("serializeRpcJsonLine writes LF-delimited JSON objects", () => {
	assert.equal(serializeRpcJsonLine({ type: "prompt", id: "one" }), '{"type":"prompt","id":"one"}\n');
});

test("attachRpcJsonlReader accepts split LF records and CRLF", () => {
	const stream = new PassThrough();
	const records: Record<string, unknown>[] = [];
	const errors: string[] = [];
	attachRpcJsonlReader(stream, (record) => records.push(record), (message) => errors.push(message));
	stream.write('{"type":"response","id":"');
	stream.write('a","success":true}\r\n{"type":"agent_end"}\n');
	assert.deepEqual(records, [{ type: "response", id: "a", success: true }, { type: "agent_end" }]);
	assert.deepEqual(errors, []);
});

test("attachRpcJsonlReader caps each record after splitting batched chunks", () => {
	const stream = new PassThrough();
	const records: Record<string, unknown>[] = [];
	const errors: string[] = [];
	attachRpcJsonlReader(stream, (record) => records.push(record), (message) => errors.push(message), 40);
	stream.write(`${JSON.stringify({ type: "response", id: "a" })}\n${JSON.stringify({ type: "agent_end" })}\n`);
	assert.deepEqual(records, [{ type: "response", id: "a" }, { type: "agent_end" }]);
	assert.deepEqual(errors, []);

	const overlong = new PassThrough();
	const overlongErrors: string[] = [];
	attachRpcJsonlReader(overlong, () => undefined, (message) => overlongErrors.push(message), 20);
	overlong.write(`${JSON.stringify({ type: "response", id: "a" })}\n`);
	assert.equal(overlongErrors.some((message) => message.includes("record exceeded 20")), true);
});

test("attachRpcJsonlReader rejects unterminated and non-object records", async () => {
	const unterminated = new PassThrough();
	const errors: string[] = [];
	attachRpcJsonlReader(unterminated, () => undefined, (message) => errors.push(message));
	unterminated.write('{"type":"response"}');
	unterminated.end();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(errors.some((message) => message.includes("unterminated")), true);

	const scalar = new PassThrough();
	const scalarErrors: string[] = [];
	attachRpcJsonlReader(scalar, () => undefined, (message) => scalarErrors.push(message));
	scalar.write('[]\n');
	assert.equal(scalarErrors.some((message) => message.includes("object")), true);
});
