import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_AGENT_TIER,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { taskQueueIntegrationPolicy } from "#modules/repo-tasks/task-integration-policy.js";
import { applyDispositionOperation } from "./apply-disposition.js";
import {
  type AppliedDisposition,
  finalizeImproverDisposition,
  IMPROVER_DISPOSITION_ARTIFACT,
  type ImproverDispositionArtifact,
  verifyImproverDispositionAfterReconcile,
} from "./disposition-publication.js";
import {
  decodeIssueDisposition,
  issueDispositionOutputSchema,
} from "./issue-disposition.js";
import { selectIssue } from "./issue-selection.js";

export const agent: AgentDef = {
  name: "improver",
  role: "Disposition one durable autonomy issue without editing implementation files.",
  promptPath: "src/modules/autonomy/workflows/improver/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: "deny-all",
};

const applyDisposition = typedCodeStep<AppliedDisposition>({
  id: "apply-disposition",
  type: "code",
  when: stepSucceeded("review-issue"),
  validate: (raw) =>
    expectStructuredOutput<AppliedDisposition>(raw, [
      "issueKey",
      "semanticRevision",
      "ownerFingerprint",
      "disposition",
      "proposal",
      "materialized",
      "recovery",
    ]),
  run: (ctx) =>
    ctx.runBlocking(applyDispositionOperation, {
      workspaceRoot: ctx.workspaceRoot,
      scopeRoot: ctx.scopeRoot,
      issue: selectIssue.outputRequired(ctx).issue!,
      disposition: decodeIssueDisposition(ctx.stepOutputs["review-issue"]),
      workflowRunId: ctx.workflow.runId,
    }),
});

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) =>
    applyDisposition.output(ctx)?.materialized.touchedTaskQueue === true,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: async (ctx) => {
    const applied = applyDisposition.outputRequired(ctx);
    await mkdir(ctx.workflow.runDirPath, { recursive: true });
    await writeFile(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `improver: materialize ${applied.issueKey} disposition\n`,
      "utf-8",
    );
    return { written: true };
  },
});

const writeDispositionArtifact = typedCodeStep<{ written: true }>({
  id: "write-disposition-artifact",
  type: "code",
  when: (ctx) => applyDisposition.output(ctx) !== undefined,
  validate: (raw) =>
    expectStructuredOutput<{ written: true }>(raw, ["written"]),
  run: async (ctx) => {
    const artifact: ImproverDispositionArtifact = {
      schemaVersion: 1,
      decidedAt: new Date().toISOString(),
      applied: applyDisposition.outputRequired(ctx),
    };
    await mkdir(ctx.workflow.runDirPath, { recursive: true });
    await writeFile(
      join(ctx.workflow.runDirPath, IMPROVER_DISPOSITION_ARTIFACT),
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf-8",
    );
    return { written: true } as const;
  },
});

const improverWorkflow: WorkflowDefinitionInput = {
  name: "improver",
  tags: ["systemic-observer"],
  repository: "write",
  finalize: finalizeImproverDisposition,
  integration: taskQueueIntegrationPolicy({ postReconcile: verifyImproverDispositionAfterReconcile }),
  description:
    "Disposition one new or materially revised durable autonomy issue and route implementation through generated work.",
  defaultAutonomyMode: "autonomous",
  triggers: [{ event: autonomyIssueDecisionRequested.name }],
  steps: [
    selectIssue,
    {
      id: "review-issue",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_TIER,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      outputFormat: "json",
      outputSchema: issueDispositionOutputSchema,
      validate: decodeIssueDisposition,
      when: (ctx) => selectIssue.output(ctx)?.eligible === true,
    },
    applyDisposition,
    writeCommitMessage,
    writeDispositionArtifact,
  ],
};

export { issueDispositionOutputSchema };
export default improverWorkflow;
