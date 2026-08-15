import { isAbsolute, resolve } from "node:path";
import type { AgentWriteScope } from "#core/agents/agent-types.js";
import { isScopePolicyPathWithin } from "#core/daemon/scope-policy-paths.js";

/**
 * Resolve a declared agent write scope into machine-enforceable roots.
 * `undefined` means the caller has no agent definition, while an empty array
 * on AgentWriteScope remains the explicit unrestricted declaration.
 */
export function resolveAgentWriteScopeRoots(
  cwd: string,
  writeScope: AgentWriteScope | undefined,
): string[] | undefined {
  if (writeScope === undefined || (writeScope !== "deny-all" && writeScope.length === 0)) {
    return undefined;
  }
  if (writeScope === "deny-all") return [];

  const workspaceRoot = resolve(cwd);
  return [...new Set(writeScope.map((entry) => {
    const root = resolve(workspaceRoot, entry);
    if (!isScopePolicyPathWithin(workspaceRoot, root)) {
      throw new Error(
        `Agent write scope path ${JSON.stringify(entry)} resolves outside workspace ${workspaceRoot}.`,
      );
    }
    return root;
  }))];
}

/**
 * Resolve the complete pre-mutation boundary for a named workflow agent.
 * The runtime-owned output directory is an explicit exception to the agent's
 * project mutation scope, including for read-only (`deny-all`) agents.
 */
export function resolveAgentFilesystemWriteRoots(
  cwd: string,
  writeScope: AgentWriteScope | undefined,
  agentOutputDir: string | undefined,
): string[] | undefined {
  const declaredRoots = resolveAgentWriteScopeRoots(cwd, writeScope);
  if (declaredRoots === undefined) return undefined;
  if (agentOutputDir === undefined) return declaredRoots;

  const workspaceRoot = resolve(cwd);
  if (!isAbsolute(agentOutputDir)) {
    throw new Error(
      `Agent output directory must be absolute: ${JSON.stringify(agentOutputDir)}.`,
    );
  }
  const outputRoot = resolve(agentOutputDir);
  if (
    outputRoot === workspaceRoot ||
    isScopePolicyPathWithin(outputRoot, workspaceRoot)
  ) {
    throw new Error(
      `Agent output directory ${JSON.stringify(agentOutputDir)} must not contain workflow workspace ${workspaceRoot}.`,
    );
  }
  return [...new Set([...declaredRoots, outputRoot])];
}

/** Intersect machine-policy roots with the narrower agent-owned roots. */
export function intersectWritableRoots(
  policyRoots: readonly string[],
  agentRoots: readonly string[] | undefined,
): string[] {
  if (agentRoots === undefined) return [...policyRoots];

  const intersections = policyRoots.flatMap((policyRoot) =>
    agentRoots.flatMap((agentRoot) => {
      if (isScopePolicyPathWithin(policyRoot, agentRoot)) return [agentRoot];
      if (isScopePolicyPathWithin(agentRoot, policyRoot)) return [policyRoot];
      return [];
    })
  );
  return [...new Set(intersections)];
}
