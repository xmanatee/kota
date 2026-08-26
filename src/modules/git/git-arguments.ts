import { isAbsolute } from "node:path";
import { resolveContainedPath } from "#core/tools/path-containment.js";

export type GitArgumentResult<T> =
	| { ok: true; value: T }
	| { ok: false; message: string };

export type BranchArguments =
	| { action: "list" }
	| { action: "create"; name: string }
	| { action: "switch"; name: string }
	| { action: "delete"; force: boolean; name: string };

const LOG_FLAGS = new Set([
	"--all",
	"--author-date-order",
	"--branches",
	"--date-order",
	"--decorate",
	"--first-parent",
	"--graph",
	"--merges",
	"--no-decorate",
	"--no-merges",
	"--oneline",
	"--remotes",
	"--reverse",
	"--tags",
	"--topo-order",
]);
const LOG_SEPARATE_VALUE_OPTIONS = new Set([
	"--after",
	"--author",
	"--before",
	"--committer",
	"--date",
	"--decorate-refs",
	"--decorate-refs-exclude",
	"--grep",
	"--max-count",
	"--since",
	"--skip",
	"--until",
	"-n",
]);
const LOG_REQUIRED_INLINE_VALUE_OPTIONS = new Set(["--format"]);
const LOG_OPTIONAL_INLINE_VALUE_OPTIONS = new Set(["--pretty"]);
const NUMERIC_LOG_OPTIONS = new Set(["--max-count", "--skip", "-n"]);

function valid<T>(value: T): GitArgumentResult<T> {
	return { ok: true, value };
}

function invalid<T>(message: string): GitArgumentResult<T> {
	return { ok: false, message };
}

function splitArguments(args: string): string[] {
	return args.trim() ? args.trim().split(/\s+/) : [];
}

function optionName(argument: string): string {
	const separator = argument.indexOf("=");
	return separator < 0 ? argument : argument.slice(0, separator);
}

export function validateRepoPath(
	argument: string,
	repoRoot: string,
): GitArgumentResult<string> {
	if (argument.includes("\0")) {
		return invalid("Git paths may not contain NUL bytes");
	}
	if (/^[A-Za-z]:[\\/]/.test(argument) || argument.startsWith("\\\\")) {
		return invalid(`Git path "${argument}" is outside the repository`);
	}
	const resolved = resolveContainedPath(argument, repoRoot, repoRoot);
	if (!resolved.ok) {
		return invalid(`Git path "${argument}" is outside the repository`);
	}
	return valid(argument);
}

function validateReadPositional(
	argument: string,
	repoRoot: string,
): GitArgumentResult<string> {
	if (isAbsolute(argument)) {
		return invalid(`Git path "${argument}" is outside the repository`);
	}
	return validateRepoPath(argument, repoRoot);
}

export function parseStatusArguments(args: string): GitArgumentResult<[]> {
	if (args.trim()) {
		return invalid("Git status does not accept arguments");
	}
	return valid([]);
}

export function parseDiffArguments(
	args: string,
	repoRoot: string,
): GitArgumentResult<string[]> {
	const parsed: string[] = [];
	let optionsEnded = false;
	for (const argument of splitArguments(args)) {
		if (!optionsEnded && argument === "--") {
			optionsEnded = true;
			parsed.push(argument);
			continue;
		}
		if (!optionsEnded && argument.startsWith("-")) {
			if (argument !== "--cached" && argument !== "--staged") {
				return invalid(`Git diff option "${optionName(argument)}" is not allowed`);
			}
			parsed.push(argument);
			continue;
		}
		const path = validateReadPositional(argument, repoRoot);
		if (!path.ok) return path;
		parsed.push(path.value);
	}
	return valid(parsed);
}

export function parseLogArguments(
	args: string,
	repoRoot: string,
): GitArgumentResult<string[]> {
	const parsed = splitArguments(args || "--oneline -20");
	let optionsEnded = false;
	for (let index = 0; index < parsed.length; index += 1) {
		const argument = parsed[index];
		if (!optionsEnded && argument === "--") {
			optionsEnded = true;
			continue;
		}
		if (!optionsEnded && /^-\d+$/.test(argument)) continue;
		if (!optionsEnded && /^-n\d+$/.test(argument)) continue;
		if (!optionsEnded && LOG_FLAGS.has(argument)) continue;
		if (!optionsEnded && LOG_OPTIONAL_INLINE_VALUE_OPTIONS.has(argument)) {
			continue;
		}
		if (!optionsEnded && LOG_SEPARATE_VALUE_OPTIONS.has(argument)) {
			const value = parsed[index + 1];
			if (value === undefined) {
				return invalid(`Git log option "${argument}" requires a value`);
			}
			if (NUMERIC_LOG_OPTIONS.has(argument) && !/^\d+$/.test(value)) {
				return invalid(`Git log option "${argument}" requires a non-negative integer`);
			}
			index += 1;
			continue;
		}
		if (!optionsEnded && argument.startsWith("--")) {
			const name = optionName(argument);
			if (
				(LOG_SEPARATE_VALUE_OPTIONS.has(name) ||
					LOG_REQUIRED_INLINE_VALUE_OPTIONS.has(name) ||
					LOG_OPTIONAL_INLINE_VALUE_OPTIONS.has(name)) &&
				argument.includes("=")
			) {
				const value = argument.slice(argument.indexOf("=") + 1);
				if (!value) return invalid(`Git log option "${name}" requires a value`);
				if (NUMERIC_LOG_OPTIONS.has(name) && !/^\d+$/.test(value)) {
					return invalid(`Git log option "${name}" requires a non-negative integer`);
				}
				continue;
			}
			if (LOG_REQUIRED_INLINE_VALUE_OPTIONS.has(name)) {
				return invalid(
					`Git log option "${name}" requires a value joined with "="`,
				);
			}
			return invalid(`Git log option "${name}" is not allowed`);
		}
		if (!optionsEnded && argument.startsWith("-")) {
			return invalid(`Git log option "${optionName(argument)}" is not allowed`);
		}
		const positional = validateReadPositional(argument, repoRoot);
		if (!positional.ok) return positional;
	}
	return valid(parsed);
}

export function parseShowArguments(
	args: string,
	repoRoot: string,
): GitArgumentResult<string> {
	const parsed = splitArguments(args);
	if (parsed.length > 1) {
		return invalid("Git show accepts exactly one commit ref");
	}
	const ref = parsed[0] ?? "HEAD";
	if (ref.startsWith("-")) {
		return invalid(`Git show option "${optionName(ref)}" is not allowed`);
	}
	const positional = validateReadPositional(ref, repoRoot);
	return positional.ok ? valid(ref) : positional;
}

export function parseAddArguments(
	args: string,
	repoRoot: string,
): GitArgumentResult<string[]> {
	const parsed = splitArguments(args);
	if (parsed.length === 0) {
		return invalid("Git add file paths required");
	}
	for (const argument of parsed) {
		if (argument.startsWith("-")) {
			return invalid(`Git add option "${optionName(argument)}" is not allowed`);
		}
		const path = validateRepoPath(argument, repoRoot);
		if (!path.ok) return path;
	}
	return valid(parsed);
}

export function parseCommitArguments(args: string): GitArgumentResult<string> {
	const message = args.trim();
	if (!message) return invalid("Git commit message required");
	if (message.includes("\0")) {
		return invalid("Git commit messages may not contain NUL bytes");
	}
	return valid(message);
}

export function parseBranchArguments(args: string): GitArgumentResult<BranchArguments> {
	const parsed = splitArguments(args);
	if (parsed.length === 0) return valid({ action: "list" });
	if (parsed.length === 1) {
		const name = validateBranchName(parsed[0]);
		return name.ok ? valid({ action: "create", name: name.value }) : name;
	}
	if (parsed.length !== 2) {
		return invalid("Invalid Git branch arguments");
	}
	const [action, rawName] = parsed;
	const name = validateBranchName(rawName);
	if (!name.ok) return name;
	if (action === "checkout" || action === "switch") {
		return valid({ action: "switch", name: name.value });
	}
	if (action === "-d" || action === "-D") {
		return valid({
			action: "delete",
			force: action === "-D",
			name: name.value,
		});
	}
	return invalid("Invalid Git branch arguments");
}

function validateBranchName(name: string): GitArgumentResult<string> {
	if (
		!name ||
		name.startsWith("-") ||
		/[\0-\x20\x7f~^:?*[\\]/.test(name) ||
		name.includes("..") ||
		name.includes("@{")
	) {
		return invalid(`Invalid Git branch name "${name}"`);
	}
	return valid(name);
}
