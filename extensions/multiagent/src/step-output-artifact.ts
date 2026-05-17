/** Step final artifact materialization for detached run terminal evidence. */

import { writeRunArtifact, type RunArtifactStore } from "./background-artifacts.ts";
import type { BackgroundEventStore } from "./background-events.ts";
import { boundedFinalPreview, buildStepFinalArtifact, formatAssistantFinalMessages } from "./detached-output.ts";
import type { StepState } from "./detached-state.ts";
import { recordRuntimeDiagnostic } from "./runtime-diagnostics.ts";
import type { AgentDiagnostic, StepOutput, StepStatus } from "./types.ts";

export function createStepOutputArtifact(input: { runId: string; objective: string; artifactStore: RunArtifactStore; diagnostics: AgentDiagnostic[]; events: BackgroundEventStore; state: StepState; status: StepStatus; text: string; assistantFinals?: string[] }): StepOutput {
	const assistantFinals = input.assistantFinals ?? [];
	const outputText = assistantFinals.length === 0 ? input.text : assistantFinals.length === 1 ? assistantFinals[0] ?? "" : formatAssistantFinalMessages(assistantFinals);
	const content = buildStepFinalArtifact({ runId: input.runId, objective: input.objective, step: input.state.spec, status: input.status, startedAt: input.state.startedAt, endedAt: now(), text: input.text, assistantFinals });
	try {
		const record = writeRunArtifact(input.artifactStore, `${input.state.spec.id}-final.md`, `step-final:${input.state.spec.id}`, content);
		return { stepId: input.state.spec.id, status: input.status, text: boundedFinalPreview(outputText), filePath: record.path, chars: outputText.length };
	} catch (error) {
		const message = `Could not write final artifact for ${input.state.spec.id}: ${error instanceof Error ? error.message : String(error)}`;
		recordRuntimeDiagnostic(input.diagnostics, input.events, "step-final-artifact-failed", "artifact", message);
		return { stepId: input.state.spec.id, status: input.status, text: boundedFinalPreview(outputText), filePath: undefined, chars: outputText.length };
	}
}

function now(): string {
	return new Date().toISOString();
}
