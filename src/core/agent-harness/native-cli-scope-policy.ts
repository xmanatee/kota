import { relative, resolve } from "node:path";
import type { ResolvedScopePolicy } from "#core/daemon/scope-policy.js";
import {
  isScopePolicyPathWithin,
  resolveScopePolicyPath,
} from "#core/daemon/scope-policy-paths.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";

export function nativeCliWritableRoots(args: {
  cwd: string;
  autonomyMode: AutonomyMode | undefined;
  scopePolicy: ResolvedScopePolicy | undefined;
}): string[] {
  if (args.autonomyMode === "passive") return [];

  const policy = args.scopePolicy;
  if (policy === undefined) return [resolve(args.cwd)];
  if (policy.ownerConfirmation.localWrite !== "allow") return [];

  if (policy.writes.mode === "none") return [];
  if (policy.writes.mode === "unrestricted") return [resolve(args.cwd)];

  const scopeRoot = policy.directoryRoot === undefined
    ? null
    : resolveScopePolicyPath(policy.directoryRoot, undefined);
  if (scopeRoot === null) {
    throw new Error(
      `Native CLI cannot project ${policy.writes.mode} writes without a valid scope directory.`,
    );
  }
  if (policy.writes.mode === "scope-directory") return [resolve(args.cwd)];

  return [...new Set(policy.writes.paths.map((path) => {
    const resolvedPath = resolveScopePolicyPath(path, scopeRoot);
    if (
      resolvedPath === null ||
      !isScopePolicyPathWithin(scopeRoot, resolvedPath)
    ) {
      throw new Error(
        `Native CLI cannot project write path ${JSON.stringify(path)} outside scope directory ${scopeRoot}.`,
      );
    }
    return resolve(args.cwd, relative(scopeRoot, resolvedPath));
  }))];
}
