import { isAbsolute } from "node:path";
import {
	type GitArgumentResult,
	validateRepoPath,
} from "./git-arguments.js";

const OPTIONS_WITH_SEPARATE_VALUES = new Set([
	"--exec",
	"--push-option",
	"--receive-pack",
	"--recurse-submodules",
	"-o",
]);
const SUPPORTED_LONG_OPTIONS = new Set([
	"--all",
	"--atomic",
	"--branches",
	"--delete",
	"--dry-run",
	"--follow-tags",
	"--force",
	"--force-if-includes",
	"--force-with-lease",
	"--ipv4",
	"--ipv6",
	"--mirror",
	"--no-all",
	"--no-atomic",
	"--no-branches",
	"--no-delete",
	"--no-dry-run",
	"--no-follow-tags",
	"--no-force",
	"--no-force-if-includes",
	"--no-force-with-lease",
	"--no-mirror",
	"--no-porcelain",
	"--no-progress",
	"--no-prune",
	"--no-push-option",
	"--no-quiet",
	"--no-recurse-submodules",
	"--no-repo",
	"--no-set-upstream",
	"--no-signed",
	"--no-tags",
	"--no-thin",
	"--no-verbose",
	"--no-verify",
	"--porcelain",
	"--progress",
	"--prune",
	"--quiet",
	"--set-upstream",
	"--signed",
	"--tags",
	"--thin",
	"--verbose",
	"--verify",
]);
const SUPPORTED_LONG_OPTIONS_WITH_INLINE_VALUES = new Set([
	"--exec",
	"--force-with-lease",
	"--push-option",
	"--receive-pack",
	"--recurse-submodules",
	"--repo",
	"--signed",
]);
const DISALLOWED_EXECUTION_OPTIONS = new Set([
	"--exec",
	"--receive-pack",
	"--signed",
]);
const PUSH_SHORT_FLAGS = new Set(["4", "6", "d", "f", "n", "q", "u", "v"]);
const RECURSE_SUBMODULE_VALUES = new Set(["check", "no", "on-demand", "only"]);

export type PushArgumentAnalysis = {
	forceWithLease: boolean;
	globalNonLeaseForce: boolean;
	hasDestructiveRemoteOption: boolean;
	repository: string | null;
	refspecs: string[];
	targetsAllBranches: boolean;
	targetsTags: boolean;
	unsupportedLongOption: string | null;
};

function pushPositionals(parts: readonly string[]): {
	positionals: string[];
	repositoryOption: string | null;
	unsupportedLongOption: string | null;
} {
	const positionals: string[] = [];
	let repositoryOption: string | null = null;
	let unsupportedLongOption: string | null = null;
	let optionsEnded = false;

	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index];
		if (!optionsEnded && part === "--") {
			optionsEnded = true;
			continue;
		}
		if (!optionsEnded && part === "--repo") {
			repositoryOption = parts[index + 1] ?? null;
			index += 1;
			continue;
		}
		if (!optionsEnded && part.startsWith("--repo=")) {
			repositoryOption = part.slice("--repo=".length) || null;
			continue;
		}
		if (!optionsEnded && OPTIONS_WITH_SEPARATE_VALUES.has(part)) {
			index += 1;
			continue;
		}
		if (!optionsEnded && part.startsWith("-o") && part.length > 2) continue;
		if (!optionsEnded && part.startsWith("--")) {
			const separator = part.indexOf("=");
			const optionName = separator < 0 ? part : part.slice(0, separator);
			const supported =
				(separator < 0 && SUPPORTED_LONG_OPTIONS.has(optionName)) ||
				(separator >= 0 &&
					SUPPORTED_LONG_OPTIONS_WITH_INLINE_VALUES.has(optionName));
			if (!supported && unsupportedLongOption === null) {
				unsupportedLongOption = part;
			}
			continue;
		}
		if (!optionsEnded && part.startsWith("-")) continue;
		positionals.push(part);
	}

	return { positionals, repositoryOption, unsupportedLongOption };
}

function hasShortOption(parts: readonly string[], option: string): boolean {
	for (const part of parts) {
		if (!/^-[^-]+$/.test(part)) continue;
		for (const shortOption of part.slice(1)) {
			if (shortOption === option) return true;
			if (shortOption === "o") break;
		}
	}
	return false;
}

export function analyzePushArguments(args: string): PushArgumentAnalysis {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	const {
		positionals,
		repositoryOption,
		unsupportedLongOption,
	} = pushPositionals(parts);
	const repository = repositoryOption ?? positionals[0] ?? null;
	const refspecs = repositoryOption ? positionals : positionals.slice(1);
	const forceWithLease = parts.some(
		(part) => part === "--force-with-lease" || part.startsWith("--force-with-lease="),
	);
	const globalNonLeaseForce = parts.some(
		(part) => part === "--force" || part === "--mirror",
	) || hasShortOption(parts, "f");
	const hasDestructiveRemoteOption = parts.some(
		(part) => part === "--delete" || part === "--mirror" || part === "--prune",
	) || hasShortOption(parts, "d");
	const targetsAllBranches = parts.some(
		(part) => part === "--all" || part === "--branches" || part === "--mirror",
	);

	return {
		forceWithLease,
		globalNonLeaseForce,
		hasDestructiveRemoteOption,
		repository,
		refspecs,
		targetsAllBranches,
		targetsTags: parts.includes("--tags"),
		unsupportedLongOption,
	};
}

function valid<T>(value: T): GitArgumentResult<T> {
	return { ok: true, value };
}

function invalid<T>(message: string): GitArgumentResult<T> {
	return { ok: false, message };
}

function optionName(argument: string): string {
	const separator = argument.indexOf("=");
	return separator < 0 ? argument : argument.slice(0, separator);
}

function validatePushRepository(
	repository: string,
	repoRoot: string,
): GitArgumentResult<string> {
	if (repository.startsWith("file:") || repository.startsWith("~")) {
		return invalid(`Git push target "${repository}" is outside the repository`);
	}
	if (
		isAbsolute(repository) ||
		/^[A-Za-z]:[\\/]/.test(repository) ||
		repository.startsWith("\\\\")
	) {
		return validateRepoPath(repository, repoRoot);
	}
	if (repository.includes("://") || /^[^/\\]+:.+$/.test(repository)) {
		return valid(repository);
	}
	return validateRepoPath(repository, repoRoot);
}

export function parsePushArguments(
	args: string,
	repoRoot: string,
): GitArgumentResult<string[]> {
	const parsed = args.trim().split(/\s+/).filter(Boolean);
	const positionals: string[] = [];
	let repositoryOption: string | null = null;
	let optionsEnded = false;

	for (let index = 0; index < parsed.length; index += 1) {
		const argument = parsed[index];
		if (!optionsEnded && argument === "--") {
			optionsEnded = true;
			continue;
		}
		if (!optionsEnded && argument.startsWith("--")) {
			const name = optionName(argument);
			if (DISALLOWED_EXECUTION_OPTIONS.has(name)) {
				return invalid(`Git push option "${name}" is not allowed`);
			}
			if (name === "--repo") {
				const inlineValue = argument.includes("=")
					? argument.slice(argument.indexOf("=") + 1)
					: undefined;
				const value = inlineValue ?? parsed[index + 1];
				if (!value) return invalid('Git push option "--repo" requires a value');
				repositoryOption = value;
				if (inlineValue === undefined) index += 1;
				continue;
			}
			if (name === "--push-option") {
				const inlineValue = argument.includes("=")
					? argument.slice(argument.indexOf("=") + 1)
					: undefined;
				const value = inlineValue ?? parsed[index + 1];
				if (!value) {
					return invalid('Git push option "--push-option" requires a value');
				}
				if (inlineValue === undefined) index += 1;
				continue;
			}
			if (name === "--recurse-submodules") {
				const inlineValue = argument.includes("=")
					? argument.slice(argument.indexOf("=") + 1)
					: undefined;
				const value = inlineValue ?? parsed[index + 1];
				if (value === undefined || !RECURSE_SUBMODULE_VALUES.has(value)) {
					return invalid(
						'Git push option "--recurse-submodules" has an invalid value',
					);
				}
				if (inlineValue === undefined) index += 1;
				continue;
			}
			const separator = argument.indexOf("=");
			const supported =
				(separator < 0 && SUPPORTED_LONG_OPTIONS.has(name)) ||
				(separator >= 0 &&
					SUPPORTED_LONG_OPTIONS_WITH_INLINE_VALUES.has(name));
			if (!supported) {
				return invalid(
					`unable to verify push safety: unsupported or abbreviated push option: ${name}`,
				);
			}
			continue;
		}
		if (!optionsEnded && argument === "-o") {
			if (parsed[index + 1] === undefined) {
				return invalid('Git push option "-o" requires a value');
			}
			index += 1;
			continue;
		}
		if (!optionsEnded && argument.startsWith("-o") && argument.length > 2) {
			continue;
		}
		if (!optionsEnded && /^-[^-]+$/.test(argument)) {
			const flags = [...argument.slice(1)];
			if (flags.every((flag) => PUSH_SHORT_FLAGS.has(flag))) continue;
			return invalid(`Git push option "${argument}" is not allowed`);
		}
		positionals.push(argument);
	}

	const repository = repositoryOption ?? positionals[0];
	if (repository !== undefined) {
		const target = validatePushRepository(repository, repoRoot);
		if (!target.ok) return target;
	}
	return valid(parsed);
}
