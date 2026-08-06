import {
  type AgentHarnessResult,
  createWorkflowAgentGuards,
  hasAgentHarness,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";
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
  shadowSemanticReviewShouldBlock,
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
  stagedDiffArtifacts,
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

const DEFAULT_SHADOW_REVIEW_MAX_TURNS = 8;

export type ShadowSemanticReviewStepResult = {
  artifactPath: string;
  status: ShadowSemanticReviewStatus;
  decision: ShadowSemanticReviewDecision;
  blocked: boolean;
};

export type ExecutableShadowSemanticReviewerDeclaration =
  ShadowSemanticReviewerDeclaration & {
    targetResolver: (ctx: WorkflowStepContext) => ShadowSemanticReviewTargetResolution;
  };

export type ShadowSemanticReviewInvoker = (
  prompt: string,
  cwd: string,
  declaration: ShadowSemanticReviewerDeclaration,
) => Promise<AgentHarnessResult>;

class ShadowSemanticReviewBlockingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShadowSemanticReviewBlockingError";
  }
}

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
    maxTurns: declaration.reviewer.maxTurns ?? DEFAULT_SHADOW_REVIEW_MAX_TURNS,
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
  blocked: boolean,
): ShadowSemanticReviewStepResult {
  return { artifactPath: path, status: artifact.status, decision: artifact.decision, blocked };
}

export async function runShadowSemanticReview(args: {
  ctx: WorkflowStepContext;
  declaration: ExecutableShadowSemanticReviewerDeclaration;
  invoker?: ShadowSemanticReviewInvoker;
}): Promise<ShadowSemanticReviewStepResult> {
  const { ctx, declaration } = args;
  validateShadowSemanticReviewerDeclaration(ctx.projectDir, declaration);
  const resolution = declaration.targetResolver(ctx);
  if (resolution.kind === "skip") {
    const { path } = writeShadowSemanticReviewArtifact(ctx, declaration, {
      status: "skipped",
      decision: "skip",
      summary: resolution.reason,
      citedArtifacts: resolution.citedArtifacts ?? [],
      findings: [],
      skippedReason: resolution.reason,
      costUsd: null,
      durationMs: null,
    });
    return resultFromArtifact(path, { status: "skipped", decision: "skip" }, false);
  }

  const startedAt = Date.now();
  try {
    const prompt = buildShadowSemanticReviewPrompt(declaration, resolution);
    const cwd = ctx.workspaceDir ?? ctx.projectDir;
    const response = args.invoker
      ? await args.invoker(prompt, cwd, declaration)
      : await defaultInvoker(prompt, cwd, declaration, ctx);
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
      costUsd: response.totalCostUsd ?? null,
      durationMs: Date.now() - startedAt,
    });
    const blocked = shadowSemanticReviewShouldBlock(artifact);
    if (blocked) {
      throw new ShadowSemanticReviewBlockingError(
        `Blocking shadow reviewer "${declaration.id}" rejected the target`,
      );
    }
    return resultFromArtifact(path, artifact, false);
  } catch (error) {
    if (error instanceof ShadowSemanticReviewBlockingError) {
      throw error;
    }
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
      costUsd: null,
      durationMs: Date.now() - startedAt,
    });
    if (declaration.mode === "blocking") throw error;
    return resultFromArtifact(path, { status, decision }, false);
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
        "blocked",
      ]),
    resolveAgentContract: (runtime) =>
      resolveShadowSemanticReviewRunContract(runtime, args.declaration),
    run: (ctx) => runShadowSemanticReview({ ctx, declaration: args.declaration }),
  });
}
