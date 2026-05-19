import type { AgentTeamNotice, CleanupReceipt, EventType, MessageReceipt } from "./types.ts";

export interface DetachedRunDetailsOptions {
	cursor?: string;
	stepId?: string;
	maxBytes?: number;
	preview?: boolean;
	message?: MessageReceipt;
	cleanup?: CleanupReceipt;
	ok?: boolean;
	error?: { code: string; message: string };
	includeEvents?: boolean;
	notice?: AgentTeamNotice;
}

export interface DetachedRunEventInput {
	stepId?: string;
	type: EventType;
	label?: string;
	preview?: string;
	status?: string;
}
