const DEBUG = process.env.DEBUG === "true";

export function log(message: string, data?: unknown): void {
	console.log(`[stupeflix] ${message}`);
	if (DEBUG && data !== undefined) {
		console.log(JSON.stringify(data, null, 2));
	}
}

export function debug(message: string, data?: unknown): void {
	if (!DEBUG) return;
	console.log(`[debug] ${message}`);
	if (data !== undefined) {
		console.log(JSON.stringify(data, null, 2));
	}
}

export function error(message: string, err?: unknown): void {
	console.error(`[error] ${message}`);
	if (err) console.error(err);
}
