import { type FormEvent, useState } from "react";
import { api, clearToken, setToken } from "../api/client";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

/**
 * The token screen. Shown when nothing is stored yet, and again whenever the API
 * answers 401 — a token pinned through `STUPEFLIX_TOKEN` can change under a
 * running browser, and the stored one then has to be replaced rather than nursed.
 *
 * It proves the token against `GET /status` and not `GET /health`: the
 * healthcheck is the one route served without a token, so it would greet a wrong
 * one just as warmly.
 */
export function Unlock({ onUnlocked }: { onUnlocked: () => void }) {
	const [value, setValue] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [checking, setChecking] = useState(false);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (!value.trim() || checking) return;
		setChecking(true);
		setError(null);
		setToken(value.trim());
		try {
			await api.getAppStatus();
			onUnlocked();
		} catch {
			// Stored optimistically above so the probe carries it; a refusal has to
			// take it back out, or the next reload starts from a token we know is bad.
			clearToken();
			setError("That token was refused.");
		} finally {
			setChecking(false);
		}
	};

	return (
		<form onSubmit={submit} className="space-y-4">
			<div>
				<h2 className="text-lg font-medium text-white">Unlock Stupeflix</h2>
				<p className="mt-1 text-sm text-white/50">
					The access token is printed in the server log at startup, or set
					through STUPEFLIX_TOKEN.
				</p>
			</div>
			<Input
				label="Access token"
				type="password"
				value={value}
				autoFocus
				autoComplete="off"
				onChange={(e) => setValue(e.target.value)}
			/>
			{error ? <p className="text-sm text-step-fail">{error}</p> : null}
			<Button type="submit" disabled={!value.trim() || checking}>
				{checking ? "Checking…" : "Unlock"}
			</Button>
		</form>
	);
}
