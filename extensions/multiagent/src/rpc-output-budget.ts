/** Retained assistant-output budget for one RPC child step. */

import type { StepOutputLimit } from "./types.ts";
import { DEFAULT_STEP_OUTPUT_LIMIT } from "./step-output-limit.ts";

const OUTPUT_BUDGET_LABEL = "step-output-budget-exceeded";

export interface OutputBudgetFailure {
	label: typeof OUTPUT_BUDGET_LABEL;
	message: string;
}

export type OutputBudgetCheck = { ok: true; bytes: number } | { ok: false; failure: OutputBudgetFailure };

export class AssistantOutputBudget {
	private liveTextBytes = 0;
	private assistantFinalBytes = 0;
	private assistantFinalCount = 0;
	private readonly limit: StepOutputLimit;

	constructor(limit: StepOutputLimit = DEFAULT_STEP_OUTPUT_LIMIT) {
		this.limit = limit;
	}

	resetLiveText(): void {
		this.liveTextBytes = 0;
	}

	appendLiveTextDelta(delta: string): OutputBudgetCheck {
		const nextBytes = this.liveTextBytes + Buffer.byteLength(delta, "utf8");
		if (nextBytes > this.limit.maxBytes) return budgetExceeded("assistant text_delta", nextBytes, this.limit);
		this.liveTextBytes = nextBytes;
		return { ok: true, bytes: nextBytes };
	}

	measureText(text: string, label: string): OutputBudgetCheck {
		const bytes = Buffer.byteLength(text, "utf8");
		return bytes <= this.limit.maxBytes ? { ok: true, bytes } : budgetExceeded(label, bytes, this.limit);
	}

	setLiveTextBytes(bytes: number): void {
		this.liveTextBytes = bytes;
	}

	canAcceptAssistantFinal(bytes: number): OutputBudgetFailure | undefined {
		if (this.assistantFinalCount >= this.limit.maxAssistantFinals) {
			return { label: OUTPUT_BUDGET_LABEL, message: `step-output-budget-exceeded: Subagent emitted too many non-empty assistant finals; limit=${this.limit.maxAssistantFinals}.` };
		}
		const nextBytes = this.assistantFinalBytes + bytes;
		return nextBytes <= this.limit.maxBytes ? undefined : budgetExceeded("assistant finals", nextBytes, this.limit).failure;
	}

	recordAssistantFinal(bytes: number): void {
		this.assistantFinalCount += 1;
		this.assistantFinalBytes += bytes;
	}

	resetAssistantFinals(): void {
		this.assistantFinalBytes = 0;
		this.assistantFinalCount = 0;
	}
}

function budgetExceeded(label: string, bytes: number, limit: StepOutputLimit): { ok: false; failure: OutputBudgetFailure } {
	return {
		ok: false,
		failure: {
			label: OUTPUT_BUDGET_LABEL,
			message: `step-output-budget-exceeded: Subagent ${label} would retain ${bytes} bytes; per-step assistant output limit=${limit.maxBytes} bytes.`,
		},
	};
}
