import type { ResolvedScopePolicy } from "#core/daemon/scope-policy.js";
import { decideScopePolicyToolCall } from "#core/daemon/scope-policy-tool-query.js";
import { findModuleManifestToolEffect } from "#core/modules/module-manifest.js";
import { confirmAction } from "#core/util/confirm.js";
import { getToolEffect } from "./index.js";
import type { ClientApprovalResult } from "./tool-approval.js";
import { extractApprovalContext } from "./tool-approval.js";
import { enqueueToolApproval } from "./tool-runner-approval-queue.js";
import type {
  ToolCallExecutionOptions,
  ToolResultEntry,
  ValidatedToolUseBlock,
} from "./tool-runner-types.js";

export async function enforceToolScopePolicy(args: {
  block: ValidatedToolUseBlock;
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

  const manifestEffect = findModuleManifestToolEffect(block.name);
  if (manifestEffect) {
    const availability = policy.modules.overrides.find(
      (entry) => entry.moduleName === manifestEffect.moduleName,
    )?.availability ?? policy.modules.defaultAvailability;
    if (availability !== "enabled") {
      return errorEntry(
        block,
        `Blocked by scope policy: module ${manifestEffect.moduleName} is ${availability} ` +
          `(source ${policy.modules.source.scopeId}).`,
      );
    }
  }

  const effect = getToolEffect(block.name, block.input);
  if (!effect) {
    return errorEntry(
      block,
      `Blocked by scope policy: ${block.name} has no declared tool effect.`,
    );
  }
  const decision = decideScopePolicyToolCall(
    policy,
    block.name,
    effect,
    block.input,
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
    const queued = enqueueToolApproval({
      approvalQueue: options.approvalQueue,
      toolName: block.name,
      input: block.input,
      risk: args.risk,
      reason: decision.rendered,
      sessionId: options.sessionId,
      timeoutMs: options.guardrailsConfig?.approvalTimeoutMs,
      context: approvalContext,
      mcpManager: options.mcpManager,
      promptFingerprints: options.mcpPromptToolDeclarationFingerprints,
    });
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
