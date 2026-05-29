const GUI_HELPER_ENV_KEYS = [
	"DISPLAY",
	"XAUTHORITY",
	"XDG_RUNTIME_DIR",
	"WAYLAND_DISPLAY",
	"DBUS_SESSION_BUS_ADDRESS",
	"__CF_USER_TEXT_ENCODING",
] as const;

const EXEC_OPTS = { timeout: 5000, stdio: "pipe" as const };

export function guiHelperExecOptions(): typeof EXEC_OPTS & { env: NodeJS.ProcessEnv } {
	return {
		...EXEC_OPTS,
		env: buildGuiHelperEnv(process.env),
	};
}

function buildGuiHelperEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const key of GUI_HELPER_ENV_KEYS) {
		const value = source[key];
		if (value !== undefined) env[key] = value;
	}
	return env;
}

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
