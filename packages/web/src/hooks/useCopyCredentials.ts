import { useState } from "react";
import type { Credentials } from "../api/client";

/**
 * `navigator.clipboard` exists only in a secure context — HTTPS or localhost —
 * and the wizard is usually reached as `http://<box>:3000`, where it is
 * `undefined`. The deprecated `execCommand("copy")` on a selected textarea is
 * the one copy a plain-HTTP page is still allowed.
 */
async function writeClipboard(text: string): Promise<boolean> {
	if (navigator.clipboard) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Denied permission falls through to the legacy path
		}
	}
	const area = document.createElement("textarea");
	area.value = text;
	area.setAttribute("readonly", "");
	area.style.position = "fixed";
	area.style.opacity = "0";
	document.body.appendChild(area);
	area.select();
	try {
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		area.remove();
	}
}

/**
 * Puts a service's secret on the clipboard and holds the "Copied" confirmation
 * for two seconds. Which field counts as the secret is a template's business,
 * so the three shapes services use are all accepted.
 */
export function useCopyCredentials(credentials?: Credentials) {
	const [copied, setCopied] = useState<string | null>(null);

	const copyPassword = async (serviceId: string) => {
		const cred = credentials?.[serviceId];
		const pass = cred?.pass ?? cred?.password ?? cred?.token;
		if (!pass) return;
		// "Copied" only when it was: a confirmation for a copy that failed is
		// how the user ends up pasting whatever was on the clipboard before
		if (!(await writeClipboard(pass))) return;
		setCopied(serviceId);
		setTimeout(() => setCopied(null), 2000);
	};

	return { copied, copyPassword };
}

export type CopyCredentials = ReturnType<typeof useCopyCredentials>;
