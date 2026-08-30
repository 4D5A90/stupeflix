import { useState } from "react";
import { api } from "../api/client";

/**
 * Runs the on-demand actions a service's template declares, and remembers which
 * one is in flight or just finished so the card can say so.
 *
 * Both are keyed by `service:action`, so two services can run their own action
 * at once without either one's button reacting to the other's.
 */
export function useServiceActions() {
	const [ranAction, setRanAction] = useState<string | null>(null);
	const [runningAction, setRunningAction] = useState<string | null>(null);

	const runAction = (service: string, action: string) => {
		const key = `${service}:${action}`;
		setRunningAction(key);
		const minSpin = new Promise((r) => setTimeout(r, 1000));
		Promise.all([api.runAction(service, action), minSpin])
			.then(() => {
				setRunningAction(null);
				setRanAction(key);
				setTimeout(() => setRanAction(null), 3000);
			})
			.catch(() => setRunningAction(null));
	};

	return { ranAction, runningAction, runAction };
}

export type ServiceActions = ReturnType<typeof useServiceActions>;
