import { useState } from "react";
import type { Credentials } from "../api/client";

/**
 * Puts a service's secret on the clipboard and holds the "Copied" confirmation
 * for two seconds. Which field counts as the secret is a template's business,
 * so the three shapes services use are all accepted.
 */
export function useCopyCredentials(credentials?: Credentials) {
	const [copied, setCopied] = useState<string | null>(null);

	const copyPassword = (serviceId: string) => {
		const cred = credentials?.[serviceId];
		const pass = cred?.pass ?? cred?.password ?? cred?.token;
		if (!pass) return;
		navigator.clipboard.writeText(pass);
		setCopied(serviceId);
		setTimeout(() => setCopied(null), 2000);
	};

	return { copied, copyPassword };
}

export type CopyCredentials = ReturnType<typeof useCopyCredentials>;
