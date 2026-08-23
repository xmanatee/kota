import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import { stepSucceeded } from "#modules/autonomy/shared.js";
import { createSecurityFindingTasksOperation } from "./blocking-operations.js";
import { scanCandidates } from "./candidate-steps.js";
import {
  decodeSecurityInvestigationOutput,
  decodeSecurityRevalidationOutputForInvestigation,
  type SecurityFindingTaskResult,
  type SecurityInvestigationOutput,
  type SecurityRevalidationOutput,
  writeJsonArtifact,
  writeSecurityReviewOutcome,
} from "./security-review.js";

function investigationOutput(
  ctx: WorkflowStepContext,
): SecurityInvestigationOutput | undefined {
  if (!stepSucceeded("investigate-candidates")(ctx)) return undefined;
  const raw = ctx.stepOutputs["investigate-candidates"];
  return raw === undefined ? undefined : decodeSecurityInvestigationOutput(raw);
}

export const recordInvestigationFindings = typedCodeStep<
  SecurityInvestigationOutput & { artifactPath: string }
>({
  id: "record-investigation-findings",
  type: "code",
  exposeOutputToAgent: true,
  when: stepSucceeded("investigate-candidates"),
  validate: (raw) =>
    expectStructuredOutput<
      SecurityInvestigationOutput & { artifactPath: string }
    >(raw, ["findings", "artifactPath"]),
  run: (ctx) => {
    const output = investigationOutput(ctx) ?? { findings: [] };
    const artifactPath = writeJsonArtifact(
      ctx.workflow.runDirPath,
      "security-review-investigation.json",
      output,
    );
    return { ...output, artifactPath };
  },
});

export const recordNoFindings = typedCodeStep<{
  written: true;
  artifactPath: string;
}>({
  id: "record-no-findings",
  type: "code",
  when: (ctx) => recordInvestigationFindings.output(ctx)?.findings.length === 0,
  validate: (raw) =>
    expectStructuredOutput<{ written: true; artifactPath: string }>(raw, [
      "written",
      "artifactPath",
    ]),
  run: (ctx) =>
    writeSecurityReviewOutcome(ctx.workflow.runDirPath, {
      outcome: "no-op",
      reason: "no-investigation-findings",
      candidateCount: scanCandidates.output(ctx)?.candidateCount ?? 0,
    }),
});

function revalidationOutput(
  ctx: WorkflowStepContext,
): SecurityRevalidationOutput | undefined {
  if (!stepSucceeded("revalidate-findings")(ctx)) return undefined;
  const raw = ctx.stepOutputs["revalidate-findings"];
  if (raw === undefined) return undefined;
  const investigation = recordInvestigationFindings.output(ctx);
  if (!investigation) {
    throw new Error("Security revalidation requires recorded investigation findings.");
  }
  return decodeSecurityRevalidationOutputForInvestigation(raw, investigation);
}

export const recordRevalidation = typedCodeStep<
  SecurityRevalidationOutput & { artifactPath: string }
>({
  id: "record-revalidation",
  type: "code",
  exposeOutputToAgent: true,
  when: stepSucceeded("revalidate-findings"),
  validate: (raw) =>
    expectStructuredOutput<
      SecurityRevalidationOutput & { artifactPath: string }
    >(raw, ["findings", "summary", "artifactPath"]),
  run: (ctx) => {
    const output = revalidationOutput(ctx) ?? {
      findings: [],
      summary: "No findings.",
    };
    const artifactPath = writeJsonArtifact(
      ctx.workflow.runDirPath,
      "security-review-revalidation.json",
      output,
    );
    return { ...output, artifactPath };
  },
});

export const createFollowUpTasks = typedCodeStep<
  SecurityFindingTaskResult & { artifactPath: string }
>({
  id: "create-follow-up-tasks",
  type: "code",
  when: (ctx) => recordRevalidation.output(ctx) !== undefined,
  validate: (raw) =>
    expectStructuredOutput<SecurityFindingTaskResult & { artifactPath: string }>(
      raw,
      [
        "createdTaskIds",
        "updatedTaskIds",
        "unchangedFindingIds",
        "skippedFindingIds",
        "taskPaths",
        "artifactPath",
      ],
    ),
  run: async (ctx) => {
    const revalidation = recordRevalidation.outputRequired(ctx);
    const result = await ctx.runBlocking(createSecurityFindingTasksOperation, {
      projectDir: ctx.projectDir,
      runId: ctx.workflow.runId,
      findings: revalidation.findings,
    });
    const confirmedCount =
      result.createdTaskIds.length + result.updatedTaskIds.length;
    const artifactPath = writeJsonArtifact(
      ctx.workflow.runDirPath,
      "security-review-outcome.json",
      {
        outcome: confirmedCount > 0 ? "tasks-created" : "no-op",
        reason:
          confirmedCount > 0
            ? "confirmed-findings"
            : result.unchangedFindingIds.length > 0
              ? "confirmed-findings-current"
            : "all-findings-rejected-or-uncertain",
        createdTaskIds: result.createdTaskIds,
        updatedTaskIds: result.updatedTaskIds,
        unchangedFindingIds: result.unchangedFindingIds,
        skippedFindingIds: result.skippedFindingIds,
        summary: revalidation.summary,
      },
    );
    return { ...result, artifactPath };
  },
});

export const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) => {
    const result = createFollowUpTasks.output(ctx);
    return Boolean(
      result && result.createdTaskIds.length + result.updatedTaskIds.length > 0,
    );
  },
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: (ctx) => {
    const result = createFollowUpTasks.outputRequired(ctx);
    const lines = [
      `security-review: create ${result.createdTaskIds.length} task(s), update ${result.updatedTaskIds.length}`,
      "",
      ...result.createdTaskIds.map((id) => `- create ${id}`),
      ...result.updatedTaskIds.map((id) => `- update ${id}`),
    ];
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    writeFileSync(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `${lines.join("\n")}\n`,
      "utf-8",
    );
    return { written: true };
  },
});
