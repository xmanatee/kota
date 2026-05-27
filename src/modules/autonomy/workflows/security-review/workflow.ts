import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { JsonSchemaObject } from "#core/util/json-schema-validator.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { commitWorkflowChanges } from "#modules/autonomy/commit.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_AGENT_HARNESS,
  AUTONOMY_DISALLOWED_TOOLS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import { SECURITY_REVIEW_DUE_EVENT } from "./due-check.js";
import {
  createOrUpdateSecurityFindingTasks,
  decodeSecurityInvestigationOutput,
  decodeSecurityRevalidationOutputForInvestigation,
  decodeSecurityRevalidationVerdictOutput,
  SECURITY_REVIEW_MAX_CANDIDATES,
  SECURITY_REVIEW_MAX_CANDIDATES_PER_SURFACE,
  type SecurityFindingTaskResult,
  type SecurityInvestigationOutput,
  type SecurityRevalidationOutput,
  type SecurityReviewCandidatePacket,
  scanAndWriteSecurityReviewCandidates,
  writeJsonArtifact,
  writeSecurityReviewOutcome,
} from "./security-review.js";

export const agent: AgentDef = {
  name: "security-reviewer",
  role: "Investigate bounded security-sensitive code candidates and revalidate findings.",
  promptPath: "src/modules/autonomy/workflows/security-review/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: [".kota/runs/"],
};

const securityFindingEvidenceSchema = {
  type: "object",
  required: ["path", "line", "excerpt"],
  additionalProperties: false,
  properties: {
    path: { type: "string" },
    line: { type: "number" },
    excerpt: { type: "string" },
  },
} satisfies JsonSchemaObject;

const securityInvestigationFindingSchema = {
  type: "object",
  required: [
    "id",
    "candidateId",
    "claim",
    "severity",
    "affectedPath",
    "evidence",
    "recommendedOutcome",
  ],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    candidateId: { type: "string" },
    claim: { type: "string" },
    severity: { type: "string" },
    affectedPath: { type: "string" },
    evidence: {
      type: "array",
      description: "array of evidence objects; do not return a single object",
      items: securityFindingEvidenceSchema,
    },
    recommendedOutcome: { type: "string" },
  },
} satisfies JsonSchemaObject;

const securityInvestigationOutputSchema = {
  type: "object",
  required: ["findings"],
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      description: "return [] when there are no plausible findings",
      items: securityInvestigationFindingSchema,
    },
  },
} satisfies JsonSchemaObject;

const securityRevalidationVerdictSchema = {
  type: "object",
  required: ["id", "verdict", "rationale"],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    verdict: { type: "string" },
    rationale: { type: "string" },
  },
} satisfies JsonSchemaObject;

const securityRevalidationOutputSchema = {
  type: "object",
  required: ["findings", "summary"],
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      description: "one verdict for every investigation finding",
      items: securityRevalidationVerdictSchema,
    },
    summary: {
      type: "string",
      description: "top-level revalidation summary is required",
    },
  },
} satisfies JsonSchemaObject;

const scanCandidates = typedCodeStep<SecurityReviewCandidatePacket>({
  id: "scan-candidates",
  type: "code",
  when: onNormalTrigger,
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<SecurityReviewCandidatePacket>(raw, [
      "candidates",
      "candidateCount",
      "artifactPath",
      "truncated",
    ]),
  run: ({ projectDir, workflow }) =>
    scanAndWriteSecurityReviewCandidates(projectDir, workflow.runDirPath, {
      maxCandidates: SECURITY_REVIEW_MAX_CANDIDATES,
      maxCandidatesPerSurface: SECURITY_REVIEW_MAX_CANDIDATES_PER_SURFACE,
    }),
});

const recordEmptyScan = typedCodeStep<{ written: true; artifactPath: string }>({
  id: "record-empty-scan",
  type: "code",
  when: (ctx) => scanCandidates.output(ctx)?.candidateCount === 0,
  validate: (raw) =>
    expectStructuredOutput<{ written: true; artifactPath: string }>(raw, [
      "written",
      "artifactPath",
    ]),
  run: (ctx) =>
    writeSecurityReviewOutcome(ctx.workflow.runDirPath, {
      outcome: "no-op",
      reason: "empty-scan",
      candidateCount: 0,
    }),
});

function investigationOutput(ctx: WorkflowStepContext): SecurityInvestigationOutput | undefined {
  if (!stepSucceeded("investigate-candidates")(ctx)) return undefined;
  const raw = ctx.stepOutputs["investigate-candidates"];
  if (raw === undefined) return undefined;
  return decodeSecurityInvestigationOutput(raw);
}

const recordInvestigationFindings = typedCodeStep<
  SecurityInvestigationOutput & { artifactPath: string }
>({
  id: "record-investigation-findings",
  type: "code",
  exposeOutputToAgent: true,
  when: stepSucceeded("investigate-candidates"),
  validate: (raw) =>
    expectStructuredOutput<SecurityInvestigationOutput & { artifactPath: string }>(raw, [
      "findings",
      "artifactPath",
    ]),
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

const recordNoFindings = typedCodeStep<{ written: true; artifactPath: string }>({
  id: "record-no-findings",
  type: "code",
  when: (ctx) =>
    recordInvestigationFindings.output(ctx)?.findings.length === 0,
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

function revalidationOutput(ctx: WorkflowStepContext): SecurityRevalidationOutput | undefined {
  if (!stepSucceeded("revalidate-findings")(ctx)) return undefined;
  const raw = ctx.stepOutputs["revalidate-findings"];
  if (raw === undefined) return undefined;
  const investigation = recordInvestigationFindings.output(ctx);
  if (!investigation) {
    throw new Error("Security revalidation requires recorded investigation findings.");
  }
  return decodeSecurityRevalidationOutputForInvestigation(raw, investigation);
}

const recordRevalidation = typedCodeStep<SecurityRevalidationOutput & { artifactPath: string }>({
  id: "record-revalidation",
  type: "code",
  exposeOutputToAgent: true,
  when: stepSucceeded("revalidate-findings"),
  validate: (raw) =>
    expectStructuredOutput<SecurityRevalidationOutput & { artifactPath: string }>(raw, [
      "findings",
      "summary",
      "artifactPath",
    ]),
  run: (ctx) => {
    const output = revalidationOutput(ctx) ?? { findings: [], summary: "No findings." };
    const artifactPath = writeJsonArtifact(
      ctx.workflow.runDirPath,
      "security-review-revalidation.json",
      output,
    );
    return { ...output, artifactPath };
  },
});

const createFollowUpTasks = typedCodeStep<SecurityFindingTaskResult & { artifactPath: string }>({
  id: "create-follow-up-tasks",
  type: "code",
  when: (ctx) => recordRevalidation.output(ctx) !== undefined,
  validate: (raw) =>
    expectStructuredOutput<SecurityFindingTaskResult & { artifactPath: string }>(raw, [
      "createdTaskIds",
      "updatedTaskIds",
      "skippedFindingIds",
      "taskPaths",
      "artifactPath",
    ]),
  run: (ctx) => {
    const revalidation = recordRevalidation.outputRequired(ctx);
    const result = createOrUpdateSecurityFindingTasks(ctx.projectDir, {
      runId: ctx.workflow.runId,
      findings: revalidation.findings,
    });
    const confirmedCount = result.createdTaskIds.length + result.updatedTaskIds.length;
    const artifactPath = writeJsonArtifact(ctx.workflow.runDirPath, "security-review-outcome.json", {
      outcome: confirmedCount > 0 ? "tasks-created" : "no-op",
      reason: confirmedCount > 0 ? "confirmed-findings" : "all-findings-rejected-or-uncertain",
      createdTaskIds: result.createdTaskIds,
      updatedTaskIds: result.updatedTaskIds,
      skippedFindingIds: result.skippedFindingIds,
      summary: revalidation.summary,
    });
    return { ...result, artifactPath };
  },
});

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) => {
    const result = createFollowUpTasks.output(ctx);
    if (!result) return false;
    return result.createdTaskIds.length + result.updatedTaskIds.length > 0;
  },
  validate: (raw) => expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: (ctx) => {
    const result = createFollowUpTasks.outputRequired(ctx);
    const lines = [
      `security-review: create ${result.createdTaskIds.length} task(s), update ${result.updatedTaskIds.length}`,
      "",
      ...result.createdTaskIds.map((id) => `- create ${id}`),
      ...result.updatedTaskIds.map((id) => `- update ${id}`),
    ];
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    writeFileSync(join(ctx.workflow.runDirPath, "commit-message.txt"), `${lines.join("\n")}\n`, "utf-8");
    return { written: true };
  },
});

const validateTaskQueue = typedCodeStep<{ ok: true }>({
  id: "validate-task-queue",
  type: "code",
  when: (ctx) => writeCommitMessage.output(ctx)?.written === true,
  validate: (raw) => expectStructuredOutput<{ ok: true }>(raw, ["ok"]),
  run: ({ projectDir }) => {
    assertTaskQueueValid(projectDir, { minReady: 0 });
    return { ok: true } as const;
  },
});

const securityReviewWorkflow: WorkflowDefinitionInput = {
  name: "security-review",
  description:
    "Scan KOTA for security-sensitive candidates, investigate a bounded batch, revalidate findings, and create normal follow-up tasks for confirmed vulnerabilities.",
  tags: ["monitored"],
  recoveryCapable: true,
  defaultAutonomyMode: "autonomous",
  triggers: [
    {
      event: "autonomy.security-review.requested",
      cooldownMs: 60 * 60 * 1000,
    },
    {
      event: SECURITY_REVIEW_DUE_EVENT,
      cooldownMs: 60 * 60 * 1000,
    },
    {
      event: "runtime.recovered",
    },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({ projectDir, workflowName: "security-review" }),
    },
    scanCandidates,
    recordEmptyScan,
    {
      id: "investigate-candidates",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      harness: AUTONOMY_AGENT_HARNESS,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: agent.effort,
      disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
      timeoutMs: Math.min(AUTONOMY_AGENT_HANG_TIMEOUT_MS, 45 * 60 * 1000),
      maxTurns: 8,
      outputFormat: "json",
      outputSchema: securityInvestigationOutputSchema,
      validate: decodeSecurityInvestigationOutput,
      when: (ctx) => (scanCandidates.output(ctx)?.candidateCount ?? 0) > 0,
    },
    recordInvestigationFindings,
    recordNoFindings,
    {
      id: "revalidate-findings",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      harness: AUTONOMY_AGENT_HARNESS,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: agent.effort,
      disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
      timeoutMs: Math.min(AUTONOMY_AGENT_HANG_TIMEOUT_MS, 30 * 60 * 1000),
      maxTurns: 4,
      outputFormat: "json",
      outputSchema: securityRevalidationOutputSchema,
      validate: decodeSecurityRevalidationVerdictOutput,
      when: (ctx) =>
        (recordInvestigationFindings.output(ctx)?.findings.length ?? 0) > 0,
    },
    recordRevalidation,
    createFollowUpTasks,
    writeCommitMessage,
    validateTaskQueue,
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("validate-task-queue"),
      run: ({ projectDir, workflow }) =>
        commitWorkflowChanges(projectDir, workflow.runDirPath),
    },
  ],
};

export default securityReviewWorkflow;
