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
