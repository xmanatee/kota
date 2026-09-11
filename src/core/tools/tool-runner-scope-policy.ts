import type { ResolvedScopePolicy } from "#core/daemon/scope-policy.js";
import { decideScopePolicyToolCall } from "#core/daemon/scope-policy-tool-query.js";
import { confirmAction } from "#core/util/confirm.js";
import type { ToolEffect } from "./effect.js";
import type { ToolFilesystemTargets } from "./filesystem-targets.js";
import type { ClientApprovalResult } from "./tool-approval.js";
import { extractApprovalContext } from "./tool-approval.js";
import { getModuleToolEffectMetadata } from "./tool-effect-registry.js";
import { isAgentOutputOnlyWrite } from "./tool-runner-agent-write-scope.js";
import type {
  ToolCallExecutionOptions,
  ToolResultEntry,
  ValidatedToolUseBlock,
} from "./tool-runner-types.js";

export async function enforceToolScopePolicy(args: {
  block: ValidatedToolUseBlock;
  targets: ToolFilesystemTargets;
 effect: ToolEffect | undefined;
 enqueueApproval: (reason: string, context: string | undefined) => { id: string };
  options: ToolCallExecutionOptions;
  policy: ResolvedScopePolicy;
  risk: "safe" | "moderate" | "dangerous";
  askClientApproval: (
    reason: string,
    approvalContext: string | undefined,
  ) => Promise<ClientApprovalResult>;
  emitAssessment: (policy: "deny" | "confirm", reason: string) => void;
}): Promise<ToolResultEntry | null> {
  const { block, options, policy } = args;

  const moduleName = getModuleToolEffectMetadata(block.name)?.moduleName;
  if (moduleName) {
    const availability = policy.modules.overrides.find(
      (entry) => entry.moduleName === moduleName,
    )?.availability ?? policy.modules.defaultAvailability;
    if (availability !== "enabled") {
      return errorEntry(
        block,
        `Blocked by scope policy: module ${moduleName} is ${availability} ` +
          `(source ${policy.modules.source.scopeId}).`,
      );
    }
  }

  const effect = args.effect;
  if (!effect) {
    return errorEntry(
      block,
      `Blocked by scope policy: ${block.name} has no declared tool effect.`,
    );
  }
  // Agent output is outside the project write catalog by construction. Reopen
  // only that path boundary; owner-confirmation policy (especially destructive
  // effects) must still decide the call.
  const decisionPolicy: ResolvedScopePolicy =
    policy.writes.mode !== "none" && isAgentOutputOnlyWrite(block, options, args.targets, effect)
      ? {
          ...policy,
          writes: { mode: "unrestricted", source: policy.writes.source },
        }
      : policy;
  const decision = decideScopePolicyToolCall(
    decisionPolicy,
    block.name,
    effect,
    block.input,
    args.targets,
  );
  if (decision.outcome === "deny" || decision.outcome === "ignore") {
    args.emitAssessment("deny", decision.rendered);
    return errorEntry(block, `Blocked by scope policy: ${decision.rendered}`);
  }
  if (decision.outcome !== "confirm") return null;

  const approvalContext = options.messages
    ? extractApprovalContext(options.messages)
    : undefined;
  args.emitAssessment("confirm", decision.rendered);
  const clientDecision = await args.askClientApproval(decision.rendered, approvalContext);
  if (clientDecision.outcome === "blocked") return clientDecision.result;
  let approved = clientDecision.outcome === "allowed";
  if (!approved && options.approvalQueue) {
    const queued = args.enqueueApproval(decision.rendered, approvalContext);
    return errorEntry(block, `Queued for approval [${queued.id}]: ${decision.rendered}`);
  }
  if (!approved) approved = await confirmAction(`Allow ${block.name}? (${decision.reason})`);
  return approved
    ? null
    : errorEntry(block, `Blocked by scope policy: ${decision.rendered}`);
}

function errorEntry(block: ValidatedToolUseBlock, content: string): ToolResultEntry {
  return { tool_use_id: block.id, content, is_error: true };
}
