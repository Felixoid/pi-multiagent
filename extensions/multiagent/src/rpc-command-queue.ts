import { serializeRpcJsonLine, type RpcJsonRecord } from "./rpc-jsonl.ts";
import { stringField } from "./rpc-record-utils.ts";

export interface RpcCommandAck {
	success: boolean;
	error: string | undefined;
}

interface PendingRpcCommand {
	command: string;
	resolve: (ack: RpcCommandAck) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface RpcCommandWriter {
	write: (line: string) => unknown;
}

export class RpcCommandQueue {
	private readonly timeoutMs: number;
	private readonly pending = new Map<string, PendingRpcCommand>();
	private nextCommandId = 0;

	constructor(timeoutMs: number) {
		this.timeoutMs = timeoutMs;
	}

	get pendingCount(): number {
		return this.pending.size;
	}

	send(stdin: RpcCommandWriter | undefined, command: RpcJsonRecord): Promise<RpcCommandAck> {
		if (!stdin) return Promise.resolve({ success: false, error: "RPC child is not live." });
		const id = `cmd-${++this.nextCommandId}`;
		const commandName = typeof command.type === "string" ? command.type : "unknown";
		const payload = { id, ...command };
		const ack = new Promise<RpcCommandAck>((resolve) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				resolve({ success: false, error: `RPC command ${commandName} timed out waiting for response.` });
			}, this.timeoutMs);
			timer.unref?.();
			this.pending.set(id, { command: commandName, resolve, timer });
		});
		try {
			stdin.write(serializeRpcJsonLine(payload));
		} catch (error) {
			const pending = this.pending.get(id);
			if (pending) clearTimeout(pending.timer);
			this.pending.delete(id);
			return Promise.resolve({ success: false, error: `RPC stdin write failed: ${error instanceof Error ? error.message : String(error)}` });
		}
		return ack;
	}

	handleResponse(record: RpcJsonRecord, onDiagnostic: (input: { command: string; message: string | undefined }) => void): void {
		const id = typeof record.id === "string" ? record.id : undefined;
		const command = typeof record.command === "string" ? record.command : "unknown";
		if (!id) {
			if (record.success === false) onDiagnostic({ command, message: stringField(record.error) });
			return;
		}
		const pending = this.pending.get(id);
		if (!pending) {
			onDiagnostic({ command, message: `Unexpected RPC response id ${id}.` });
			return;
		}
		clearTimeout(pending.timer);
		this.pending.delete(id);
		pending.resolve({ success: record.success === true, error: record.success === true ? undefined : stringField(record.error) ?? `RPC command ${command} failed.` });
	}

	closeWith(errorForCommand: (command: string) => string): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.resolve({ success: false, error: errorForCommand(pending.command) });
		}
		this.pending.clear();
	}
}
