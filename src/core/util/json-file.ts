import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
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
	options: { mode?: number } = {},
): void {
	const dir = dirname(path);
	const tmpPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;

	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(tmpPath, serialize(value), {
			encoding: "utf-8",
			...(options.mode !== undefined ? { mode: options.mode } : {}),
		});
		renameSync(tmpPath, path);
	} catch (error) {
		rmSync(tmpPath, { force: true });
		throw new JsonFileError(
			path,
			"write",
			`failed to write JSON file atomically: ${formatErrorMessage(error)}`,
		);
	}
}
