import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export class JsonFileError extends Error {
	constructor(
		readonly path: string,
		readonly operation: "read" | "write" | "parse",
		message: string,
	) {
		super(`${path}: ${message}`);
		this.name = "JsonFileError";
	}
}

function formatErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return String(error);
}

export function readOptionalJsonFile<T>(path: string): T | null {
	if (!existsSync(path)) return null;

	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch (error) {
		throw new JsonFileError(
			path,
			"read",
			`failed to read JSON file: ${formatErrorMessage(error)}`,
		);
	}

	try {
		return JSON.parse(raw) as T;
	} catch (error) {
		throw new JsonFileError(
			path,
			"parse",
			`invalid JSON: ${formatErrorMessage(error)}`,
		);
	}
}

export function writeJsonFileAtomic(
	path: string,
	value: unknown,
	serialize: (value: unknown) => string = (current) =>
		`${JSON.stringify(current, null, 2)}\n`,
): void {
	const dir = dirname(path);
	const tmpPath = `${path}.tmp`;

	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(tmpPath, serialize(value), "utf-8");
		renameSync(tmpPath, path);
	} catch (error) {
		throw new JsonFileError(
			path,
			"write",
			`failed to write JSON file atomically: ${formatErrorMessage(error)}`,
		);
	}
}
