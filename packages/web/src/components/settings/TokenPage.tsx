import { useState } from "react";
import { getToken } from "../../api/client";
import { writeClipboard } from "../../hooks/useCopyCredentials";
import { Button } from "../ui/Button";

/**
 * The token this browser holds, and the way to forget it. Read from the
 * client rather than the API: the server never hands a token back out, and the
 * one stored here is by definition the one that works.
 */
export function TokenPage({ onLock }: { onLock: () => void }) {
	const token = getToken();
	const [shown, setShown] = useState(false);
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		// Same rule as the credentials: "Copied" only when it was.
		if (!(await writeClipboard(token))) return;
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<>
			<h2 className="text-[32px] font-bold leading-tight">Access token</h2>
			<section className="flex flex-col gap-4 rounded-lg bg-card p-6">
				<div className="flex flex-wrap items-center gap-3">
					<span className="flex h-12 min-w-0 flex-[1_1_320px] items-center overflow-hidden rounded bg-page px-4 font-mono text-[15px] tracking-[0.08em]">
						<span className="truncate">{shown ? token : "•".repeat(24)}</span>
					</span>
					<Button
						variant="outline"
						size="lg"
						className="text-[15px]"
						aria-pressed={shown}
						onClick={() => setShown((on) => !on)}
					>
						{shown ? "Hide" : "Show"}
					</Button>
					<Button
						variant="solid"
						size="lg"
						className="text-[15px]"
						onClick={copy}
					>
						{copied ? "Copied" : "Copy"}
					</Button>
				</div>
				<p className="text-sm leading-normal text-muted">
					Minted on first boot and kept in the database. Pin your own with
					STUPEFLIX_TOKEN — the server checks it at startup and refuses to start
					with one a browser cannot send.
				</p>
			</section>
			<section className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-card p-6">
				<span className="flex flex-col gap-1">
					<strong className="text-lg">This browser</strong>
					<span className="text-sm text-muted">
						Forget the token here. You will need it again to unlock.
					</span>
				</span>
				<Button variant="outline" onClick={onLock}>
					Lock
				</Button>
			</section>
		</>
	);
}
