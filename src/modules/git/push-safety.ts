import {
	localDestructiveEffect,
	networkDestructiveEffect,
	networkWriteEffect,
	type ToolEffect,
} from "#core/tools/effect.js";
import type { ToolEffectResolver } from "#core/tools/tool-effect-registry.js";
import { parseBranchArguments } from "./git-arguments.js";
import {
	analyzePushArguments,
	type PushArgumentAnalysis,
} from "./push-arguments.js";

const PROTECTED_BRANCHES = new Set(["main", "master"]);

export type PushConfigReader = {
	getAll: (key: string) => Promise<readonly string[]>;
	getBoolean: (key: string) => Promise<boolean | null>;
	getRemoteGroup: (name: string) => Promise<readonly string[]>;
	hasRemote: (name: string) => Promise<boolean>;
};

function normalizedDestination(refspec: string, currentBranch: string): string {
	const withoutForce = refspec.startsWith("+") ? refspec.slice(1) : refspec;
	if (withoutForce === ":") return "refs/heads/*";
	const separator = withoutForce.indexOf(":");
	if (separator >= 0) return withoutForce.slice(separator + 1);
	if (withoutForce === "HEAD" || withoutForce === "@") return currentBranch;
	if (withoutForce.startsWith("heads/")) return `refs/${withoutForce}`;
	return withoutForce;
}

function destinationTargetsProtectedBranch(destination: string): boolean {
	if (destination.length === 0) return false;
	const candidates = [
		...PROTECTED_BRANCHES,
		...Array.from(PROTECTED_BRANCHES, (branch) => `refs/heads/${branch}`),
	];
	if (!destination.includes("*")) return candidates.includes(destination);
	const expression = new RegExp(
		`^${destination
			.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
			.replaceAll("*", ".*")}$`,
	);
	return candidates.some((candidate) => expression.test(candidate));
}

function latestConfigValue(values: readonly string[]): string | null {
	return values.at(-1) ?? null;
}

async function resolvePushRemote(
	analysis: PushArgumentAnalysis,
	currentBranch: string,
	readConfig: PushConfigReader,
): Promise<string> {
	if (analysis.repository) return analysis.repository;
	const branchPushRemote = latestConfigValue(
		await readConfig.getAll(`branch.${currentBranch}.pushRemote`),
	);
	if (branchPushRemote) return branchPushRemote;
	const defaultPushRemote = latestConfigValue(
		await readConfig.getAll("remote.pushDefault"),
	);
	if (defaultPushRemote) return defaultPushRemote;
	const branchRemote = latestConfigValue(
		await readConfig.getAll(`branch.${currentBranch}.remote`),
	);
	return branchRemote || "origin";
}

async function defaultPushRefspecs(
	currentBranch: string,
	readConfig: PushConfigReader,
): Promise<readonly string[]> {
	const pushDefault = (
		latestConfigValue(await readConfig.getAll("push.default")) ?? "simple"
	).toLowerCase();
	if (pushDefault === "nothing") return [];
	if (pushDefault === "matching") return [":"];
	if (pushDefault === "upstream" || pushDefault === "tracking") {
		const upstream = latestConfigValue(
			await readConfig.getAll(`branch.${currentBranch}.merge`),
		);
		return upstream ? [`HEAD:${upstream}`] : [];
	}
	return [`HEAD:${currentBranch}`];
}

async function configuredPushRefspecs(
	analysis: PushArgumentAnalysis,
	currentBranch: string,
	readConfig: PushConfigReader,
): Promise<{ forcesAllRefs: boolean; refspecs: readonly string[] }> {
	const repository = await resolvePushRemote(analysis, currentBranch, readConfig);
	const remoteNames = await readConfig.hasRemote(repository)
		? [repository]
		: await readConfig.getRemoteGroup(repository);
	const refspecs: string[] = [];
	let needsDefault = remoteNames.length === 0;

	for (const remote of remoteNames) {
		const forcesAllRefs =
			await readConfig.getBoolean(`remote.${remote}.mirror`) === true;
		if (forcesAllRefs) return { forcesAllRefs, refspecs: [] };

		const remoteRefspecs = await readConfig.getAll(`remote.${remote}.push`);
		if (remoteRefspecs.length === 0) {
			needsDefault = true;
		} else {
			refspecs.push(...remoteRefspecs);
		}
	}

	if (needsDefault) {
		refspecs.push(...await defaultPushRefspecs(currentBranch, readConfig));
	}
	return { forcesAllRefs: false, refspecs };
}

export async function protectedNonLeaseForcePushTarget(
	args: string,
	currentBranch: string,
	readConfig: PushConfigReader,
): Promise<string | null> {
	const analysis = analyzePushArguments(args);
	if (analysis.unsupportedLongOption) {
		throw new Error(
			`unsupported or abbreviated push option: ${analysis.unsupportedLongOption}`,
		);
	}
	let refspecs: readonly string[] = analysis.refspecs;
	let forcesAllRefs = analysis.targetsAllBranches && analysis.globalNonLeaseForce;

	if (
		refspecs.length === 0 &&
		!analysis.targetsAllBranches &&
		!analysis.targetsTags
	) {
		const configured = await configuredPushRefspecs(
			analysis,
			currentBranch,
			readConfig,
		);
		refspecs = configured.refspecs;
		forcesAllRefs = configured.forcesAllRefs;
	}

	for (const refspec of refspecs) {
		const refspecForces = analysis.globalNonLeaseForce || refspec.startsWith("+");
		if (!refspecForces) continue;
		const destination = normalizedDestination(refspec, currentBranch);
		if (destinationTargetsProtectedBranch(destination)) return destination;
	}

	if (forcesAllRefs) {
		return "main/master";
	}

	return null;
}

function pushEffect(args: string): ToolEffect {
	const analysis = analyzePushArguments(args);
	const hasPositiveRefspec = analysis.refspecs.some((refspec) => refspec.startsWith("+"));
	const hasDeletionRefspec = analysis.refspecs.some((refspec) => {
		const withoutForce = refspec.startsWith("+") ? refspec.slice(1) : refspec;
		return withoutForce.startsWith(":") && withoutForce !== ":";
	});
	const mayUseConfiguredRefspec =
		analysis.refspecs.length === 0 &&
		!analysis.targetsAllBranches &&
		!analysis.targetsTags;
	if (
		analysis.forceWithLease ||
		analysis.globalNonLeaseForce ||
		analysis.hasDestructiveRemoteOption ||
		analysis.unsupportedLongOption !== null ||
		hasPositiveRefspec ||
		hasDeletionRefspec ||
		mayUseConfiguredRefspec
	) {
		return networkDestructiveEffect();
	}
	return networkWriteEffect();
}

export const resolveGitToolEffect: ToolEffectResolver = (input) => {
	const operation = typeof input.op === "string" ? input.op : "";
	const args = typeof input.args === "string" ? input.args : "";
	if (operation === "push") return pushEffect(args);
	if (operation !== "branch") return undefined;

	const branch = parseBranchArguments(args);
	if (!branch.ok || branch.value.action !== "delete") return undefined;
	return localDestructiveEffect();
};
