import { relative, resolve } from "node:path";
import type { ResolvedScopePolicy } from "#core/daemon/scope-policy.js";
import {
  isScopePolicyPathWithin,
  resolveScopePolicyPath,
} from "#core/daemon/scope-policy-paths.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";

export type NativeCliScopeProjection = {
  executionMode: "bounded-edits" | "plan";
  writableRoots: string[];
};

/**
 * Native adapters expose no KOTA modules, deny tool network access, and use
 * their CLI's fail-closed confirmation mode. This projection therefore only
 * has to narrow the remaining local filesystem capability.
 */
export function projectNativeCliScope(args: {
  cwd: string;
  autonomyMode: AutonomyMode | undefined;
  scopePolicy: ResolvedScopePolicy | undefined;
}): NativeCliScopeProjection {
  if (args.autonomyMode === "passive") {
    return { executionMode: "plan", writableRoots: [] };
  }

  const policy = args.scopePolicy;
  if (policy === undefined) {
    return { executionMode: "bounded-edits", writableRoots: [resolve(args.cwd)] };
  }
  if (
    policy.ownerConfirmation.localWrite !== "allow" ||
    policy.ownerConfirmation.destructive === "deny"
  ) {
    return { executionMode: "plan", writableRoots: [] };
  }

  if (policy.writes.mode === "none") {
    return { executionMode: "plan", writableRoots: [] };
  }
  if (policy.writes.mode === "unrestricted") {
    return { executionMode: "bounded-edits", writableRoots: [resolve(args.cwd)] };
  }

  const scopeRoot = policy.directoryRoot === undefined
    ? null
    : resolveScopePolicyPath(policy.directoryRoot, undefined);
  if (scopeRoot === null) {
    throw new Error(
      `Native CLI cannot project ${policy.writes.mode} writes without a valid scope directory.`,
    );
  }
  if (policy.writes.mode === "scope-directory") {
    return { executionMode: "bounded-edits", writableRoots: [resolve(args.cwd)] };
  }

  const writableRoots = [...new Set(policy.writes.paths.map((path) => {
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
  return {
    executionMode: writableRoots.length === 0 ? "plan" : "bounded-edits",
    writableRoots,
  };
}
