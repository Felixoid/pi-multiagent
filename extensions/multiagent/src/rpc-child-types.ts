/** Shared RPC child controller types. */

import type { AgentInvocationDefaults, ResolvedAgent, StepOutputLimit, StepStatus, TeamLimits } from "./types.ts";

export interface RpcChildControllerOptions {
	agent: ResolvedAgent;
	defaults: AgentInvocationDefaults;
	limits: TeamLimits;
	outputLimit: StepOutputLimit;
	cwd: string;
	promptPath: string;
	spawnProcess?: import("./child-launch.ts").SpawnProcess;
	ackTimeoutMs?: number;
	onEvent: (input: { type: "rpc" | "assistant_final" | "tool" | "diagnostic" | "parent_message" | "ui"; label?: string; preview?: string; status?: string }) => void;
	onText?: (text: string) => void;
}

export interface RpcStepResult {
	status: StepStatus;
	text: string;
	assistantFinals: string[];
	stderr: string;
	errorMessage: string | undefined;
	nonFinalText?: string;
}
