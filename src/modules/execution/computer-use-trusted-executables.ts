import { accessSync, constants, realpathSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";

const TRUSTED_LOOKUP_DIRS = [
	"/usr/bin",
	"/bin",
	"/usr/sbin",
	"/sbin",
	"/usr/local/bin",
	"/opt/homebrew/bin",
	"/opt/local/bin",
] as const;

const TRUSTED_REALPATH_PREFIXES = [
	"/usr/bin",
	"/bin",
	"/usr/sbin",
	"/sbin",
	"/usr/local",
	"/opt/homebrew",
	"/opt/local",
] as const;

export class UntrustedGuiHelperPathError extends Error {
	constructor(binaryName: string, path: string) {
		super(`${binaryName} resolved to untrusted path: ${path}`);
		this.name = "UntrustedGuiHelperPathError";
	}
}

export function resolveTrustedGuiHelper(binaryName: string): string | null {
	assertExecutableName(binaryName);
	const checked = new Set<string>();
	const pathEntries = (process.env.PATH ?? "").split(delimiter);

	for (const entry of pathEntries) {
		const candidate = executableCandidate(entry, binaryName);
		if (checked.has(candidate)) continue;
		checked.add(candidate);
		const resolved = resolveExecutableCandidate(binaryName, candidate);
		if (resolved) return resolved;
	}

	for (const dir of TRUSTED_LOOKUP_DIRS) {
		const candidate = join(dir, binaryName);
		if (checked.has(candidate)) continue;
		checked.add(candidate);
		const resolved = resolveExecutableCandidate(binaryName, candidate);
		if (resolved) return resolved;
	}

	return null;
}

function assertExecutableName(binaryName: string): void {
	if (!binaryName || binaryName.includes("/") || binaryName.includes("\\")) {
		throw new Error(`invalid GUI helper executable name: ${binaryName}`);
	}
}

function executableCandidate(pathEntry: string, binaryName: string): string {
	if (pathEntry === "") return resolve(process.cwd(), binaryName);
	if (isAbsolute(pathEntry)) return join(pathEntry, binaryName);
	return resolve(process.cwd(), pathEntry, binaryName);
}

function resolveExecutableCandidate(
	binaryName: string,
	candidate: string,
): string | null {
	if (!canExecute(candidate)) return null;
	const resolved = realpathSync(candidate);
	if (!isTrustedExecutable(candidate, resolved)) {
		throw new UntrustedGuiHelperPathError(binaryName, candidate);
	}
	return resolved;
}

function canExecute(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function isTrustedExecutable(candidate: string, resolved: string): boolean {
	const candidateDir = dirname(candidate);
	if (!TRUSTED_LOOKUP_DIRS.some((dir) => dir === candidateDir)) return false;
	return TRUSTED_REALPATH_PREFIXES.some((prefix) =>
		isPathWithinPrefix(resolved, prefix),
	);
}

function isPathWithinPrefix(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}${sep}`);
}
