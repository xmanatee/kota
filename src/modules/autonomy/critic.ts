import { withWorkflowBlockingOperation } from "#core/workflow/blocking-operation-context.js";
import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import {
  type AgentJudgeConfig,
  invokeAgentJudge,
  resolveAgentJudgePolicy,
  resolveAgentJudgeRunContract,
} from "./agent-judge.js";
import { runProbeIfDeclared } from "./critic-runtime-probe.js";
import {
  clearCriticOutcomeArtifact,
  handleVerdict,
} from "./critic-verdict.js";
import { criticReviewInspectionOperation } from "./review-input-operations.js";
import { formatProbeBlock } from "./task-probe.js";
import {
  readTaskReviewMutationStatus,
  type TaskReviewContract,
} from "./task-review-target.js";

export type { AgentJudgeConfig } from "./agent-judge.js";
export {
  invokeAgentJudge,
  resolveAgentJudgeRunContract,
} from "./agent-judge.js";
export type { CriticVerdict } from "./critic-verdict.js";
export { handleVerdict, parseVerdict } from "./critic-verdict.js";
export {
  getWorkflowChangedFiles,
  getWorkflowDiffContent,
  getWorkflowDiffStat,
} from "./workflow-diff.js";

const CRITIC_SYSTEM_PROMPT = `You are an independent code review critic. Decide whether the changed repository is safe to publish under the task's proposed disposition.

## Disposition

First distinguish completion from a safe incomplete disposition using the final task state, original contract in Git, repository diff, and scoped evidence. Builder summaries are claims to verify, never proof.

- For done, require the full requested outcome and its acceptance evidence.
- For blocked, require a concrete external prerequisite that prevents useful implementation, setup and proportionate validation. Missing evidence alone, a denied probe, or future runtime-owned publication is not such a prerequisite. Apply Standards: distinguish an actual defect from an unperformed check, accept sufficient equivalent scoped proof, and leave post-deployment observation to operational follow-up. A safe incomplete disposition may pass only with the real prerequisite and remaining work explicit; never claim unexecuted checks passed or infer host credential absence from sandbox denial.
- For dropped, require a supported retirement or coherent dependency-linked replacement that preserves the owner's intent and acceptance goals.
- Open is unfinished implementation. An implementation gap, failed quality target, or hard task dependency is not by itself an external blocker. Dependencies belong in depends_on. Resolve apparently stale or contradictory requirements against the actual contract and scoped evidence; do not silently lower a goal or rewrite an admitted contract.

Independently review every retained code change for safety, correctness, and sufficient proof under every disposition. Blocked never excuses broken partial code, weakened isolation, disabled functionality presented as an implementation, or unsupported claims. Safe containment must be identified as containment with the remaining implementation explicit. A failed probe that demonstrates a code defect still rejects publication; unavailable execution may support a truthful blocker but cannot prove runtime acceptance. A pass for an incomplete disposition approves only its safe changes and honest deferral.

## Review criteria

- **Fulfillment and observable behavior:** Completion satisfies the requested outcome on the real path. An incomplete disposition preserves the contract and explicitly accounts for the missing outcome, with no unsafe partial transition or contradictory task state.
- **Ownership and maintainability:** Apply the repository's engineering rules to the actual consumers. Reject material duplicated authority, lost functionality, or unmigrated callers, including an unnecessary parallel mechanism or fixture-owned runtime.
- **Safety and honesty:** Authority, trust, secrets, destructive actions, external sources, and claimed limitations are handled truthfully.
- **Proof sufficiency:** The builder's selected proof can distinguish the intended outcome from the relevant failure. Use the applicable verification guidance; do not require tests when an authoritative mechanism already proves the behavior. Passing tests establish only the behavior they exercise; they do not establish sound ownership or complete migration.

Do not review formatting, naming preferences, mechanical check output, optional refactors, or alternative valid approaches. Judge the task and changed behavior, not task labels, evidence keywords, file size, test count, or artifact shape.

## Calibration

- A critical issue is a concrete unfulfilled completion claim, unjustified incomplete disposition, incorrect or unsafe observable behavior, dishonest claim, broken ownership boundary, or insufficient proof for the proposed publication. An honestly deferred requirement alone is not critical for a safe incomplete disposition.
- A real runtime defect is critical because the behavior is wrong, not because a test is absent. Describe the observable defect and let the builder choose the smallest corrective proof.
- Product or operator evidence is relevant when the actual outcome changes an operator journey. Decide relevance from the task and behavior; do not infer it mechanically from task class, area, or keywords.
- Research that depends on an inaccessible source cannot be claimed complete unless the dependency is honestly blocked, superseded, or no longer necessary.
- A warning is a concrete non-blocking concern. It may be accepted as non-actionable when the summary explains why; a follow-up task is optional and should exist only when the work is valuable.
- Passing work may have no warnings. Summarize the concrete behavior and proof you reviewed without obeying a fixed citation syntax.

## Output format

Return exactly one JSON object with no surrounding prose or markdown:
{
  "verdict": "pass" | "fail" | "pass_with_warnings",
  "critical_issues": ["string — concrete blocking gaps"],
  "warnings": ["string — concrete non-blocking concerns"],
  "summary": "string — outcome, proof sufficiency, and any non-action reason"
}

Example:
{"verdict":"pass","critical_issues":[],"warnings":[],"summary":"The typed boundary rejects the invalid state and the production probe demonstrates the requested operator outcome."}`;

/**
 * Stable identifier for the active critic system prompt. The live calibration
 * gate aggregates only artifacts whose hash matches the running critic. When
 * review criteria change, the rolling window resets instead of comparing
 * verdicts produced under different guidance. 12 hex chars (48 bits) is
 * sufficient to distinguish prompt versions.
 */
export function getCriticPromptHash(scopeRoot: string): string {
  return resolveAgentJudgePolicy(CRITIC_SYSTEM_PROMPT, scopeRoot).hash;
}

type CriticBaseConfig = Omit<AgentJudgeConfig, "harness" | "model" | "effort">;

const criticBaseConfig: CriticBaseConfig = {
  label: "Critic agent",
  systemPrompt: CRITIC_SYSTEM_PROMPT,
};

type CriticCheckOptions = {
  runDirPath?: string;
  harnessName?: string;
  model?: string;
  resolveTaskReviewContract?: (
    payload: Record<string, unknown>,
  ) => TaskReviewContract;
};

function resolveCriticJudgeConfig(
  parentStep: WorkflowAgentStep,
  options: CriticCheckOptions | undefined,
): AgentJudgeConfig {
  return {
    ...criticBaseConfig,
    harness: options?.harnessName ?? parentStep.harness,
    model: options?.model ?? parentStep.model,
    effort: parentStep.effort,
  };
}

export function createCriticCheck(options?: CriticCheckOptions): WorkflowRepairCheck {
  /*
   * Force a specific harness/model only in direct fixtures. Production checks
   * inherit the parent step's definition-resolved contract.
   */
  return {
    id: "critic-review",
    type: "code" as const,
    resolveAgentContract: (parentStep) =>
      resolveAgentJudgeRunContract(resolveCriticJudgeConfig(parentStep, options)),
    run: async (ctx, parentStep) => {
      const reviewDir = ctx.workspaceRoot;
      const resolvedConfig = resolveCriticJudgeConfig(parentStep, options);
      const workspaceRunDir = ctx.runtimeResources?.agentRunDir;
      const runDir = options?.runDirPath ?? workspaceRunDir ?? ctx.workflow.runDirPath;
      clearCriticOutcomeArtifact(runDir);
      const inspectionInput = options?.resolveTaskReviewContract === undefined
        ? {
            reviewDir,
            taskMutationStatus: await readTaskReviewMutationStatus(
              reviewDir,
              ctx.runCommand,
            ),
          }
        : {
            reviewDir,
            taskContract: options.resolveTaskReviewContract(ctx.trigger.payload),
          };
      const inspection = await withWorkflowBlockingOperation(ctx).runBlocking(
        criticReviewInspectionOperation,
        inspectionInput,
      );
      if (inspection.status === "no-task") {
        return "OK: no active builder task — skipping critic review";
      }

      const {
        target,
        diffStat,
        diffContent,
        changedFiles,
      } = inspection;
      const taskContent = target.content;
      // A task citation selects a pinned snapshot; core independently checks the
      // run belongs to this scope before delivering any host read grant.
      resolvedConfig.evidence = { linked: [...taskContent.matchAll(
        /\.kota\/runs\/([A-Za-z0-9][A-Za-z0-9._-]*)\/evidence\/manifests\/([a-f0-9]{64})\.json/g,
      )].map(match => ({ runId: match[1]!, manifestSha256: match[2]! })) };
      const probeResult = await runProbeIfDeclared(
        taskContent,
        target.path,
        reviewDir,
        runDir,
        ctx.runCommand,
        options?.runDirPath === undefined && workspaceRunDir !== undefined
          ? reviewDir
          : undefined,
      );
      const builderSummary = ctx.stepResults.build?.output;
      const builderSummaryText =
        typeof builderSummary === "object" && builderSummary !== null &&
          "content" in builderSummary && typeof builderSummary.content === "string"
          ? builderSummary.content
          : typeof builderSummary === "string"
          ? builderSummary
          : "(no builder completion summary was recorded)";

      const userMessage = [
        "## Task (what was asked)",
        taskContent,
        "",
        "## Task state",
        `${target.path} (${target.state})`,
        "",
        "## Changed files",
        changedFiles,
        "",
        "## Builder completion summary",
        builderSummaryText,
        "",
        "## Review context",
        `Workspace root: ${reviewDir}`,
        "Runtime supplies selected evidence through the read-only handoff below.",
        "Start from the task, final task state, changed files, and diff below.",
        "Inspect the handoff projections and their provenance, integrity and unavailable states. Related maintained files remain in the review workspace.",
        "Do not require a specific evidence artifact. Use judgment, but do not accept claims that are unsupported by the task, diff, repo state, or run trace.",
        ...(probeResult ? ["", formatProbeBlock(probeResult)] : []),
        "",
        "## Diff summary",
        diffStat,
        "",
        "## Full diff",
        diffContent,
      ].join("\n");

      const response = await invokeAgentJudge(
        userMessage,
        reviewDir,
        resolvedConfig,
        ctx.runAgentHarness,
        ctx.scopeRoot,
        ctx.signal,
      );
      return handleVerdict(response, runDir);
    },
  };
}
