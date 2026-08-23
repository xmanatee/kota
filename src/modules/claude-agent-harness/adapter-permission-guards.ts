import type { AgentCanUseTool } from "#core/agent-harness/index.js";
import { composeCanUseTools } from "#core/agent-harness/index.js";
import type { AgentWriteScope } from "#core/agents/agent-types.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type {
  ResolvedScopePolicy,
  ScopePolicySnapshotAccessor,
} from "#core/daemon/scope-policy.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import {
  createClaudeAgentWriteScopeGuard,
  createClaudeScopePolicyGuard,
} from "./scope-policy-guard.js";

export function createClaudePermissionGuard(args: {
  canUseTool: AgentCanUseTool | undefined;
  scopePolicy: ResolvedScopePolicy | undefined;
  getScopePolicySnapshot: ScopePolicySnapshotAccessor | undefined;
  approvalQueue: ApprovalQueue | undefined;
  autonomyMode: AutonomyMode;
  cwd: string | undefined;
  sessionId: string | undefined;
  agentWriteScope: AgentWriteScope | undefined;
  agentOutputDir: string | undefined;
}): AgentCanUseTool | undefined {
  const scopePolicyGuard = args.scopePolicy
    ? createClaudeScopePolicyGuard({
        policy: args.scopePolicy,
        autonomyMode: args.autonomyMode,
        ...(args.getScopePolicySnapshot
          ? { getScopePolicySnapshot: args.getScopePolicySnapshot }
          : {}),
        ...(args.approvalQueue ? { approvalQueue: args.approvalQueue } : {}),
        ...(args.cwd ? { cwd: args.cwd } : {}),
        ...(args.sessionId ? { sessionId: args.sessionId } : {}),
      })
    : undefined;
  const boundedAgentWriteScope = args.agentWriteScope === "deny-all" ||
    (args.agentWriteScope !== undefined && args.agentWriteScope.length > 0);
  const agentWriteScopeGuard = boundedAgentWriteScope
    ? createClaudeAgentWriteScopeGuard({
        agentWriteScope: args.agentWriteScope!,
        ...(args.agentOutputDir ? { agentOutputDir: args.agentOutputDir } : {}),
        ...(args.cwd ? { cwd: args.cwd } : {}),
      })
    : undefined;

  // The write-scope guard runs last so an earlier callback cannot rewrite an
  // authorized output path into a sibling runtime-owned file.
  const guards = [
    args.canUseTool,
    scopePolicyGuard,
    agentWriteScopeGuard,
  ].filter((guard): guard is AgentCanUseTool => guard !== undefined);
  return guards.length > 1 ? composeCanUseTools(...guards) : guards.at(0);
}
