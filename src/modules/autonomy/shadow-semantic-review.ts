import {
  type AgentHarnessResult,
  createWorkflowAgentGuards,
  hasAgentHarness,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/usage.js";
import type { AgentRuntimeSelection } from "#core/model/preset.js";
import type {
  WorkflowPredicate,
  WorkflowStepContext,
} from "#core/workflow/run-types.js";
import type { TypedCodeStepInput } from "#core/workflow/step-input-code.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowAgentRunContractSpec } from "#core/workflow/step-types.js";
import { resolveWorkflowAgentRunContract } from "#core/workflow/steps/step-executor-agent-run-contract.js";
import {
  validateShadowSemanticReviewerDeclaration,
  writeShadowSemanticReviewArtifact,
} from "./shadow-semantic-review-artifact.js";
import {
  buildShadowSemanticReviewPrompt,
  parseShadowSemanticReviewerResponse,
  ShadowSemanticReviewParseError,
} from "./shadow-semantic-review-prompt.js";

export {
  buildShadowSemanticReviewPrompt,
  parseShadowSemanticReviewerResponse,
} from "./shadow-semantic-review-prompt.js";
export {
  shadowSemanticReviewTargetOperation,
  workflowMutationArtifacts,
} from "./shadow-semantic-review-targets.js";

import type {
  ShadowSemanticReviewArtifact,
  ShadowSemanticReviewDecision,
  ShadowSemanticReviewerDeclaration,
  ShadowSemanticReviewStatus,
  ShadowSemanticReviewTargetResolution,
} from "./shadow-semantic-review-types.js";
import { AUTONOMY_DISALLOWED_TOOLS } from "./shared.js";

export type ShadowSemanticReviewStepResult = {
  artifactPath: string;
  status: ShadowSemanticReviewStatus;
  decision: ShadowSemanticReviewDecision;
};

export type ExecutableShadowSemanticReviewerDeclaration =
  ShadowSemanticReviewerDeclaration & {
    targetResolver: (
      ctx: WorkflowStepContext,
    ) => ShadowSemanticReviewTargetResolution | Promise<ShadowSemanticReviewTargetResolution>;
  };

export type ShadowSemanticReviewInvoker = (
  prompt: string,
  cwd: string,
  declaration: ShadowSemanticReviewerDeclaration,
) => Promise<AgentHarnessResult>;

async function defaultInvoker(
  prompt: string,
  cwd: string,
  declaration: ShadowSemanticReviewerDeclaration,
  ctx: WorkflowStepContext,
): Promise<AgentHarnessResult> {
  const contract = resolveShadowSemanticReviewRunContract(ctx.agentRuntime, declaration);
  const harness = resolveAgentHarness(contract.harness);
  const resolved = resolveWorkflowAgentRunContract({
    step: contract,
    harness,
    model: contract.model,
    prompt,
    canUseTool: createWorkflowAgentGuards(),
    askOwnerSource: `shadow-review:${declaration.id}`,
  });
  return ctx.runAgentHarness(
    harness,
    {
      ...resolved.options,
      cwd,
      systemPrompt: declaration.reviewer.systemPrompt,
    },
    {
      signal: ctx.signal,
      workspaceKey: cwd,
      writer: { write: () => true },
    },
  );
}

export function resolveShadowSemanticReviewRunContract(
  runtime: AgentRuntimeSelection,
  declaration: ShadowSemanticReviewerDeclaration,
): WorkflowAgentRunContractSpec {
  const harness = hasAgentHarness(runtime.harness)
    ? resolveAgentHarness(runtime.harness)
    : undefined;
  return {
    harness: runtime.harness,
    model: declaration.reviewer.model ?? runtime.tiers.capable,
    effort: declaration.reviewer.effort ?? runtime.effort,
    autonomyMode: "autonomous",
    ownerQuestionAccess: "disabled",
    ...(harness?.toolControl === "kota"
      ? { disallowedTools: AUTONOMY_DISALLOWED_TOOLS }
      : {}),
  };
}

function resultFromArtifact(
  path: string,
  artifact: Pick<ShadowSemanticReviewArtifact, "status" | "decision">,
): ShadowSemanticReviewStepResult {
  return { artifactPath: path, status: artifact.status, decision: artifact.decision };
}

export async function runShadowSemanticReview(args: {
  ctx: WorkflowStepContext;
  declaration: ExecutableShadowSemanticReviewerDeclaration;
  invoker?: ShadowSemanticReviewInvoker;
}): Promise<ShadowSemanticReviewStepResult> {
  const { ctx, declaration } = args;
  validateShadowSemanticReviewerDeclaration(declaration);
  const resolution = await declaration.targetResolver(ctx);
  if (resolution.kind === "skip") {
    const { path } = writeShadowSemanticReviewArtifact(ctx, declaration, {
      status: "skipped",
      decision: "skip",
      summary: resolution.reason,
      citedArtifacts: resolution.citedArtifacts ?? [],
      findings: [],
      skippedReason: resolution.reason,
      usage: UNKNOWN_AGENT_USAGE,
      durationMs: null,
    });
    return resultFromArtifact(path, { status: "skipped", decision: "skip" });
  }

  const startedAt = Date.now();
  let observedUsage = UNKNOWN_AGENT_USAGE;
  try {
    const prompt = buildShadowSemanticReviewPrompt(declaration, resolution);
    const cwd = ctx.workspaceRoot;
    const response = args.invoker
      ? await args.invoker(prompt, cwd, declaration)
      : await defaultInvoker(prompt, cwd, declaration, ctx);
    observedUsage = response.usage;
    const review = parseShadowSemanticReviewerResponse(response.text);
    const { path, artifact } = writeShadowSemanticReviewArtifact(ctx, declaration, {
      status: "reviewed",
      decision: review.decision,
      target: {
        id: resolution.target.id,
        summary: resolution.target.summary,
        artifactPaths: resolution.target.artifacts.map((artifactRef) => artifactRef.path),
      },
      summary: review.summary,
      citedArtifacts: review.citedArtifacts,
      findings: review.findings,
      usage: response.usage,
      durationMs: Date.now() - startedAt,
    });
    return resultFromArtifact(path, artifact);
  } catch (error) {
    const status: ShadowSemanticReviewStatus =
      error instanceof ShadowSemanticReviewParseError ? "malformed" : "error";
    const decision: ShadowSemanticReviewDecision = "error";
    const { path } = writeShadowSemanticReviewArtifact(ctx, declaration, {
      status,
      decision,
      target: {
        id: resolution.target.id,
        summary: resolution.target.summary,
        artifactPaths: resolution.target.artifacts.map((artifactRef) => artifactRef.path),
      },
      summary: status === "malformed" ? "Reviewer returned malformed output." : "Reviewer invocation failed.",
      citedArtifacts: [],
      findings: [],
      error: error instanceof Error ? error.message : String(error),
      usage: observedUsage,
      durationMs: Date.now() - startedAt,
    });
    return resultFromArtifact(path, { status, decision });
  }
}

export function createShadowSemanticReviewStep(args: {
  id: string;
  declaration: ExecutableShadowSemanticReviewerDeclaration;
  when?: WorkflowPredicate;
}): TypedCodeStepInput<ShadowSemanticReviewStepResult> {
  return typedCodeStep<ShadowSemanticReviewStepResult>({
    id: args.id,
    type: "code",
    when: args.when,
    validate: (raw) =>
      expectStructuredOutput<ShadowSemanticReviewStepResult>(raw, [
        "artifactPath",
        "status",
        "decision",
      ]),
    resolveAgentContract: (runtime) =>
      resolveShadowSemanticReviewRunContract(runtime, args.declaration),
    run: (ctx) => runShadowSemanticReview({ ctx, declaration: args.declaration }),
  });
}
