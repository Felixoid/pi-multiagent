/** Snapshot helpers for detached-run surfaces. */

import { isTerminalRunStatus } from "./detached-output.ts";
import type { StepState } from "./detached-state.ts";
import type { StepActivityTracker } from "./step-activity.ts";
import { childToolNames } from "./tool-policy.ts";
import type { AgentInvocationDefaults, RunSnapshot, RunStatus, StepSnapshot, StepStatus, TeamStepSpec } from "./types.ts";

export function buildStepSnapshots(states: Iterable<StepState>, activity: StepActivityTracker, defaults: AgentInvocationDefaults = { model: undefined, thinking: undefined }): StepSnapshot[] {
	return [...states].map((state) => ({
		id: state.spec.id,
		status: state.status,
		agentRef: state.spec.agent.ref,
		model: state.spec.agent.model ?? defaults.model,
		thinking: state.spec.agent.thinking ?? defaults.thinking,
		effectiveTools: childToolNames(state.spec.agent),
		extensionTools: state.spec.agent.extensionTools.map((tool) => tool.name),
		callerSkills: state.spec.agent.callerSkills.map((skill) => skill.name),
		needs: state.spec.needs,
		after: state.spec.after,
		startedAt: state.startedAt,
		endedAt: state.endedAt,
		lastActivity: activity.summary(state.spec.id),
		errorMessage: state.errorMessage,
		outputFilePath: state.output?.filePath,
		outputChars: state.output?.chars,
	}));
}

export function buildRunSnapshot(input: { runId: string; objective: string; status: RunStatus; createdAt: string; updatedAt: string; retentionSeconds: number; liveStepIds: string[]; sinkStepIds: string[]; lastEvent: string | undefined; canMessage: boolean; canCancel: boolean; counts: Record<StepStatus, number> }): RunSnapshot {
	const terminal = isTerminalRunStatus(input.status);
	return { runId: input.runId, objective: input.objective, status: input.status, terminal, createdAt: input.createdAt, updatedAt: input.updatedAt, expiresAt: terminal ? new Date(Date.parse(input.updatedAt) + input.retentionSeconds * 1000).toISOString() : undefined, liveStepIds: input.liveStepIds, sinkStepIds: input.sinkStepIds, lastEvent: input.lastEvent, canMessage: input.canMessage, canCancel: input.canCancel, canCleanup: terminal, counts: input.counts };
}

export function countStepStatuses(states: Iterable<StepState>): Record<StepStatus, number> {
	const counts: Record<StepStatus, number> = { pending: 0, running: 0, succeeded: 0, failed: 0, blocked: 0, timed_out: 0, canceled: 0 };
	for (const state of states) counts[state.status] += 1;
	return counts;
}

export function findSinkStepIds(steps: TeamStepSpec[]): string[] {
	const dependedOn = new Set<string>();
	for (const step of steps) for (const dependency of [...step.needs, ...step.after]) dependedOn.add(dependency);
	return steps.filter((step) => !dependedOn.has(step.id)).map((step) => step.id);
}
