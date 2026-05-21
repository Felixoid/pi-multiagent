/** Retained assistant-output budget for one RPC child step. */

import { MAX_ASSISTANT_FINAL_MESSAGES_PER_STEP, MAX_STEP_OUTPUT_BYTES } from "./types.ts";

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

	resetLiveText(): void {
		this.liveTextBytes = 0;
	}

	appendLiveTextDelta(delta: string): OutputBudgetCheck {
		const nextBytes = this.liveTextBytes + Buffer.byteLength(delta, "utf8");
		if (nextBytes > MAX_STEP_OUTPUT_BYTES) return budgetExceeded("assistant text_delta", nextBytes);
		this.liveTextBytes = nextBytes;
		return { ok: true, bytes: nextBytes };
	}

	measureText(text: string, label: string): OutputBudgetCheck {
		const bytes = Buffer.byteLength(text, "utf8");
		return bytes <= MAX_STEP_OUTPUT_BYTES ? { ok: true, bytes } : budgetExceeded(label, bytes);
	}

	setLiveTextBytes(bytes: number): void {
		this.liveTextBytes = bytes;
	}

	canAcceptAssistantFinal(bytes: number): OutputBudgetFailure | undefined {
		if (this.assistantFinalCount >= MAX_ASSISTANT_FINAL_MESSAGES_PER_STEP) {
			return { label: OUTPUT_BUDGET_LABEL, message: `step-output-budget-exceeded: Subagent emitted too many non-empty assistant finals; limit=${MAX_ASSISTANT_FINAL_MESSAGES_PER_STEP}.` };
		}
		const nextBytes = this.assistantFinalBytes + bytes;
		return nextBytes <= MAX_STEP_OUTPUT_BYTES ? undefined : budgetExceeded("assistant finals", nextBytes).failure;
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

function budgetExceeded(label: string, bytes: number): { ok: false; failure: OutputBudgetFailure } {
	return {
		ok: false,
		failure: {
			label: OUTPUT_BUDGET_LABEL,
			message: `step-output-budget-exceeded: Subagent ${label} would retain ${bytes} bytes; per-step assistant output limit=${MAX_STEP_OUTPUT_BYTES} bytes.`,
		},
	};
}
