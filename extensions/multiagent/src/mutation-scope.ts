import type { GraphSpec } from "./schemas.ts";
import { MUTATION_CHILD_TOOL_NAMES, SHELL_CHILD_TOOL_NAMES } from "./types.ts";
import type { AgentDiagnostic, ResolvedAgent } from "./types.ts";

const MUTATION_SCOPE_TOOLS = new Set<string>(MUTATION_CHILD_TOOL_NAMES);
const WORKER_SCOPE_TOOLS = new Set<string>([...SHELL_CHILD_TOOL_NAMES, ...MUTATION_CHILD_TOOL_NAMES]);

export function resolveMutationScope(step: GraphSpec["steps"][number], agent: ResolvedAgent, diagnostics: AgentDiagnostic[], path: string): { valid: boolean; value: string | undefined } {
	const scope = step.mutationScope?.trim();
	const required = agent.tools.some((tool) => MUTATION_SCOPE_TOOLS.has(tool)) || (agent.ref === "package:worker" && agent.tools.some((tool) => WORKER_SCOPE_TOOLS.has(tool)));
	if (!scope) {
		if (!required) return { valid: true, value: undefined };
		diagnostics.push({ code: "mutation-scope-required", message: "Steps with edit/write tools, or package:worker with bash, require concrete step mutationScope naming allowed files or mutation class. Use a read-only profile or package:validator when no mutation is authorized.", severity: "error", path });
		return { valid: false, value: undefined };
	}
	if (hasConcreteMutationScope(scope)) return { valid: true, value: scope };
	diagnostics.push({ code: "mutation-scope-invalid", message: "Step mutationScope must name a concrete allowed file set or mutation class; REPLACE/TODO/TBD placeholders, angle placeholders, ellipses, and vague placeholder text are denied.", severity: "error", path });
	return { valid: false, value: undefined };
}

function hasConcreteMutationScope(scope: string): boolean {
	if (scope.length < 8) return false;
	if (/^(?:REPLACE|TODO|TBD)(?:\b|[_-])/i.test(scope)) return false;
	if (/\bplaceholder\b/i.test(scope) || scope.includes("<") || scope.includes(">") || scope.includes("...")) return false;
	return true;
}
