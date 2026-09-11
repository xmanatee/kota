import { isAbsolute } from "node:path";
import type { ToolRunnerContext } from "./tool-registry.js";

/** Mutation destinations. None declares no ancillary writes; it never exempts a local write effect. */
export type ToolFilesystemTargets =
	| { kind: "none" }
	| { kind: "known"; paths: readonly string[] }
	| { kind: "unknown" };

/** Pure declaration owned by the tool. Paths use the runner's execution context. */
export type ToolFilesystemTargetResolver = (
	input: Record<string, unknown>,
	context?: ToolRunnerContext,
) => ToolFilesystemTargets;

export function resolveFilesystemTargets(
	resolver: ToolFilesystemTargetResolver | undefined,
	input: Record<string, unknown>,
	context?: ToolRunnerContext,
): ToolFilesystemTargets {
	if (!resolver) return { kind: "none" };
	try {
		const targets = resolver(input, context);
		if (targets.kind === "none") return targets;
		// Empty/incomplete declarations cannot vacuously authorize a write.
		if (
			targets.kind !== "known" ||
			targets.paths.length === 0 ||
			targets.paths.some(
				(path) => typeof path !== "string" || !isAbsolute(path),
			)
		) {
			return { kind: "unknown" };
		}
		return { kind: "known", paths: [...new Set(targets.paths)] };
	} catch {
		return { kind: "unknown" };
	}
}
