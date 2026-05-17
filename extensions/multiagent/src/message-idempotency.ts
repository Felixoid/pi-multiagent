/** Idempotent parent-message receipt cache for live step supervision. */

import type { MessageChannel, MessageReceipt } from "./types.ts";

export type MessageCacheLookup = MessageReceipt | Promise<MessageReceipt> | "conflict" | undefined;

interface MessageCacheEntry {
	channel: MessageChannel;
	text: string;
	receipt: MessageReceipt | undefined;
	pending: Promise<MessageReceipt> | undefined;
}

export interface MessageReceiptCache {
	lookup(stepId: string, channel: MessageChannel, text: string, clientMessageId: string | undefined): MessageCacheLookup;
	reserve(stepId: string, channel: MessageChannel, text: string, clientMessageId: string | undefined, pending: Promise<MessageReceipt>): MessageCacheLookup;
	settle(stepId: string, channel: MessageChannel, text: string, clientMessageId: string | undefined, receipt: MessageReceipt): void;
}

export function createMessageReceiptCache(): MessageReceiptCache {
	const receipts = new Map<string, MessageCacheEntry>();
	return {
		lookup(stepId, channel, text, clientMessageId) {
			const key = messageKey(stepId, clientMessageId);
			if (!key) return undefined;
			const existing = receipts.get(key);
			if (!existing) return undefined;
			if (existing.channel !== channel || existing.text !== text) return "conflict";
			return existing.receipt ? { ...existing.receipt } : existing.pending;
		},
		reserve(stepId, channel, text, clientMessageId, pending) {
			const key = messageKey(stepId, clientMessageId);
			if (!key) return undefined;
			const existing = receipts.get(key);
			if (existing) {
				if (existing.channel !== channel || existing.text !== text) return "conflict";
				return existing.receipt ? { ...existing.receipt } : existing.pending;
			}
			receipts.set(key, { channel, text, receipt: undefined, pending });
			return undefined;
		},
		settle(stepId, channel, text, clientMessageId, receipt) {
			const key = messageKey(stepId, clientMessageId);
			if (!key) return;
			const existing = receipts.get(key);
			if (existing) {
				receipts.set(key, { channel: existing.channel, text: existing.text, receipt: { ...receipt }, pending: undefined });
				return;
			}
			receipts.set(key, { channel, text, receipt: { ...receipt }, pending: undefined });
		},
	};
}

function messageKey(stepId: string, clientMessageId: string | undefined): string | undefined {
	return clientMessageId ? `${stepId}\u0000${clientMessageId}` : undefined;
}
