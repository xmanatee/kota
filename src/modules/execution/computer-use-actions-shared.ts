export const EXEC_OPTS = { timeout: 5000, stdio: "pipe" as const };

export function parseCombo(raw: string): { modifiers: string[]; key: string } {
	const parts = raw.toLowerCase().split("+").map((s) => s.trim());
	const key = parts.pop()!;
	return { modifiers: parts, key };
}

export function truncText(text: string, max = 50): string {
	return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function needCoords(x: unknown, y: unknown): [number, number] {
	if (typeof x !== "number" || typeof y !== "number") {
		throw new Error("x and y coordinates are required for this action");
	}
	return [Math.round(x), Math.round(y)];
}
