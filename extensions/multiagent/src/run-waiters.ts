/** Bounded retrieve waiters for detached run material events. */

import { isMaterialRetrieveWaitEvent } from "./material-wait-events.ts";
import { unrefTimer } from "./runtime-options.ts";
import type { BackgroundEvent } from "./types.ts";

interface RunWaiter {
	stepId: string | undefined;
	sinkStepIds: readonly string[];
	resolve: () => void;
}

export class RunWaiters {
	private readonly waiters = new Set<RunWaiter>();

	add(input: { stepId?: string; sinkStepIds: readonly string[]; milliseconds: number }): Promise<void> {
		return new Promise<void>((resolve) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const waiter: RunWaiter = { stepId: input.stepId, sinkStepIds: input.sinkStepIds, resolve: finish };
			function finish(): void {
				if (timer) clearTimeout(timer);
				resolve();
			}
			this.waiters.add(waiter);
			timer = setTimeout(() => {
				this.waiters.delete(waiter);
				finish();
			}, input.milliseconds);
			unrefTimer(timer);
		});
	}

	notify(event: BackgroundEvent): void {
		for (const waiter of [...this.waiters]) {
			if (!isMaterialRetrieveWaitEvent(event, waiter)) continue;
			this.waiters.delete(waiter);
			waiter.resolve();
		}
	}
}
