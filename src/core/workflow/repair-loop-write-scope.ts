import type { ScopedRepairAgent } from "./repair-loop-types.js";
import type { WorkflowRunMetadata } from "./run-types.js";
import {
  AgentWriteScopeViolationError,
  findWriteScopeViolations,
  writeWriteScopeViolationArtifact,
} from "./steps/agent-write-scope.js";
import {
  captureWorkflowMutationSnapshot,
  type WorkflowMutationSnapshot,
} from "./steps/agent-write-scope-snapshot.js";

export function enforceRepairAgentWriteScope(args: {
  preSnapshot: WorkflowMutationSnapshot;
  workspaceDir: string;
  runtimeWriteScopes: readonly string[];
  scopedAgent: ScopedRepairAgent;
  stepId: string;
  metadata: WorkflowRunMetadata;
  scopeRoot: string;
}): void {
  const violations = findWriteScopeViolations(
    args.preSnapshot.changedPathsSince(
      captureWorkflowMutationSnapshot(args.workspaceDir),
    ),
    args.scopedAgent.writeScope,
    args.runtimeWriteScopes,
  );
  if (violations.length === 0) return;

  const violation = {
    stepId: args.stepId,
    agentName: args.scopedAgent.agentName,
    scope: args.scopedAgent.writeScope,
    violations,
  };
  writeWriteScopeViolationArtifact({
    ...violation,
    metadata: args.metadata,
    scopeRoot: args.scopeRoot,
  });
  if (args.scopedAgent.writeScope === "deny-all") {
    args.preSnapshot.restoreDenyAllMutations(args.workspaceDir, violations);
  }
  throw new AgentWriteScopeViolationError(violation);
}
