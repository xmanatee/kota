import { createHash } from "node:crypto";
import { withWorkflowBlockingOperation } from "#core/workflow/blocking-operation-context.js";
import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import {
  type AgentJudgeConfig,
  invokeAgentJudge,
  isJudgeRunawayError,
  judgeUnavailableResult,
  resolveAgentJudgeRunContract,
} from "./agent-judge.js";
import { runProbeIfDeclared } from "./critic-runtime-probe.js";
import {
  clearCriticOutcomeArtifacts,
  handleVerdict,
  parseVerdict,
} from "./critic-verdict.js";
import {
  collectOperatorEvidenceRefs,
  resolveDurableOperatorEvidenceDir,
} from "./product-evidence.js";
import { criticReviewInspectionOperation } from "./review-input-operations.js";
import { formatProbeBlock } from "./task-probe.js";
import {
  readTaskReviewMutationStatus,
  type TaskReviewContract,
} from "./task-review-target.js";

export type { AgentJudgeConfig } from "./agent-judge.js";
export {
  invokeAgentJudge,
  isJudgeRunawayError,
  judgeUnavailableResult,
  resolveAgentJudgeRunContract,
} from "./agent-judge.js";
export type { CriticVerdict } from "./critic-verdict.js";
export { handleVerdict, parseVerdict } from "./critic-verdict.js";
export {
  getWorkflowChangedFiles,
  getWorkflowDiffContent,
  getWorkflowDiffStat,
} from "./workflow-diff.js";

const CRITIC_SYSTEM_PROMPT = `You are an independent code review critic. Decide whether the changed repository genuinely fulfills the assigned task.

## Review criteria

- **Fulfillment and observable behavior:** The requested outcome and constraints are complete on the real path, with no half-finished transition or contradictory task state.
- **Ownership and maintainability:** The change leaves one clear owner for each behavior and does not introduce an unnecessary parallel mechanism, compatibility path, or fixture-owned runtime.
- **Safety and honesty:** Authority, trust, secrets, destructive actions, external sources, and claimed limitations are handled truthfully.
- **Proof sufficiency:** The builder's selected proof can distinguish the intended outcome from the relevant failure. Valid proof may be a type, schema, generated contract, production run, durable record, direct inspection, or behavior test. Do not require a test when another authoritative mechanism closes the failure more directly.

Do not review formatting, naming preferences, mechanical check output, optional refactors, or alternative valid approaches. Judge the task and changed behavior, not task labels, evidence keywords, file size, test count, or artifact shape.

## Calibration

- A critical issue is a concrete unfulfilled requirement, incorrect or unsafe observable behavior, dishonest claim, broken ownership boundary, or proof that cannot support the completion claim.
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
export function getCriticPromptHash(): string {
  return createHash("sha256").update(CRITIC_SYSTEM_PROMPT).digest("hex").slice(0, 12);
}

const CRITIC_MAX_TURNS = 20;

type CriticBaseConfig = Omit<AgentJudgeConfig, "harness" | "model" | "effort">;

const criticBaseConfig: CriticBaseConfig = {
  label: "Critic agent",
  systemPrompt: CRITIC_SYSTEM_PROMPT,
  maxTurns: CRITIC_MAX_TURNS,
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

function taskIdFromReviewTargetPath(path: string): string | undefined {
  return path.match(/(?:^|\/)(task-[^/]+)\.md$/)?.[1];
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
      const reviewDir = ctx.projectDir;
      const resolvedConfig = resolveCriticJudgeConfig(parentStep, options);
      const workspaceRunDir = ctx.runtimeResources?.agentRunDir;
      const runDir = options?.runDirPath ?? workspaceRunDir ?? ctx.workflow.runDirPath;
      const durableEvidenceDir = options?.runDirPath !== undefined
        ? runDir
        : resolveDurableOperatorEvidenceDir(reviewDir, runDir);
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
        return "OK: no task in doing/ — skipping critic review";
      }

      const {
        target,
        diffStat,
        diffContent,
        changedFiles,
      } = inspection;
      const taskContent = target.content;
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
      const operatorEvidenceRefs = collectOperatorEvidenceRefs({
        evidenceDirPath: durableEvidenceDir,
        changedFiles,
        hasRuntimeProbeResult: probeResult !== null,
      });
      const taskId = taskIdFromReviewTargetPath(target.path);
      const verdictContext = {
        runId: ctx.workflow.runId,
        workflow: ctx.workflow.name,
        reviewerPromptHash: getCriticPromptHash(),
        taskId,
      };

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
        `Project root: ${reviewDir}`,
        `Run directory: ${runDir}`,
        "Start from the task, final task state, changed files, and diff below.",
        "If completeness is uncertain, inspect run artifacts yourself: metadata.json, steps/*.json (structured step outputs), steps/*.input.md, steps/*.tool-telemetry.json, and related repo files.",
        "Do not require a specific evidence artifact. Use judgment, but do not accept claims that are unsupported by the task, diff, repo state, or run trace.",
        operatorEvidenceRefs.length > 0
          ? `Available operator evidence refs: ${operatorEvidenceRefs.join(", ")}`
          : "Available operator evidence refs: none found. Decide whether the actual outcome needs operator-visible proof; do not infer that from metadata or keywords.",
        "You have a 20-turn budget. Budget it for judgment, not exploration: the diff, task, and step JSON outputs are almost always enough. Do not open `steps/*.events.jsonl` — it is a raw per-tool event stream, routinely 1–3 MB, and burns the budget without adding signal. Reach for it only if nothing else explains a concrete gap you already suspect.",
        "",
        "## Useful run artifact globs",
        `${runDir}/metadata.json`,
        `${runDir}/steps/*.json`,
        `${runDir}/steps/*.input.md`,
        `${runDir}/steps/*.tool-telemetry.json`,
        ...(probeResult ? ["", formatProbeBlock(probeResult)] : []),
        "",
        "## Diff summary",
        diffStat,
        "",
        "## Full diff",
        diffContent,
      ].join("\n");

      let response: Awaited<ReturnType<typeof invokeAgentJudge>>;
      clearCriticOutcomeArtifacts(runDir);
      try {
        response = await invokeAgentJudge(
          userMessage,
          reviewDir,
          resolvedConfig,
          ctx.runAgentHarness,
          ctx.signal,
        );
      } catch (err) {
        const judgeError = err instanceof Error ? err : new Error(String(err));
        // Runaway judge (max turns / max tokens) is an evaluator-side
        // problem the agent cannot fix by editing code. Returning a
        // warning lets the build proceed on mechanical checks and
        // prevents repair-loop thrashing. Evidence: run
        // 2026-04-20T14-30-41-306Z-builder-gb9pnn wasted 3 repair
        // iterations (~$3.73, ~45 min) on this exact path before the
        // critic finally returned a verdict on its own.
        if (isJudgeRunawayError(judgeError)) {
          return judgeUnavailableResult("critic", judgeError);
        }
        throw err;
      }
      if (response.isError) {
        const recovered = parseVerdict(response.text);
        return handleVerdict(recovered, runDir, "critic-review.json", {
          ...verdictContext,
          failureDetailMode: "artifact-reference",
        });
      }

      const verdict = parseVerdict(response.text);
      return handleVerdict(verdict, runDir, "critic-review.json", {
        ...verdictContext,
        failureDetailMode: "artifact-reference",
      });
    },
  };
}
