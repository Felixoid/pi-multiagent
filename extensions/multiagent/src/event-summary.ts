/** Human summaries for compact run status cards. */

import type { BackgroundEvent } from "./types.ts";
import { summarizeStepActivity } from "./step-activity.ts";

export function summarizeBackgroundEvent(event: BackgroundEvent | undefined): string | undefined {
	if (!event) return undefined;
	const step = event.stepId ? `${event.stepId}: ` : "";
	return `${step}${summarizeStepActivity(event)}`;
}
