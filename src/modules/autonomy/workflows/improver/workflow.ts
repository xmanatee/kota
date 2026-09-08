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
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssueProjection,
  decodeAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_AGENT_TIER,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { applyDispositionOperation } from "./apply-disposition.js";
import {
  type ImproverWorktreeInspection,
  inspectImproverWorktreeOperation,
} from "./blocking-operations.js";
import {
  type AppliedDisposition,
  IMPROVER_DISPOSITION_ARTIFACT,
  IMPROVER_DISPOSITION_PUBLICATION_REQUESTED_EVENT,
  type ImproverDispositionArtifact,
  improverDispositionPublicationKey,
  isImproverDispositionCurrent,
  readImproverDispositionArtifact,
} from "./disposition-publication.js";
import {
  decodeIssueDisposition,
  issueDispositionOutputSchema,
} from "./issue-disposition.js";
import { selectIssue, selectIssueForProjection } from "./issue-selection.js";

export const agent: AgentDef = {
  name: "improver",
  role: "Disposition one durable autonomy issue without editing implementation files.",
  promptPath: "src/modules/autonomy/workflows/improver/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: "deny-all",
};

const inspectWorktree = typedCodeStep<ImproverWorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<ImproverWorktreeInspection>(raw, [
      "dirty",
      "summary",
    ]),
  run: ({ workspaceRoot, runBlocking }) =>
    runBlocking(inspectImproverWorktreeOperation, { workspaceRoot }),
});

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

const validateChanges = typedCodeStep<{ ok: true }>({
  id: "validate-changes",
  type: "code",
  when: (ctx) =>
    applyDisposition.output(ctx) !== undefined &&
    (applyDisposition.output(ctx)?.materialized.touchedTaskQueue !== true ||
      writeCommitMessage.output(ctx) !== undefined),
  validate: (raw) => expectStructuredOutput<{ ok: true }>(raw, ["ok"]),
  run: async (ctx) => {
    await ctx.runCommand({
      command: "pnpm",
      args: ["run", "validate-tasks"],
      cwd: ctx.workspaceRoot,
    });
    return { ok: true } as const;
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
  repository: "write",
  integration: {
    validationCommand: ["pnpm", "validate-tasks"],
    postReconcile: (input) => {
      input.signal.throwIfAborted();
      const projection = decodeAutonomyIssueProjection(
        input.readState<AutonomyIssueProjection>(
          AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
        ).value,
      );
      const artifact = readImproverDispositionArtifact(
        input.stateDir,
        input.runId,
      );
      if (artifact === null) {
        if (input.head === input.baseHead && !selectIssueForProjection({
          trigger: input.trigger,
          projection,
        }).eligible) {
          return { satisfied: true };
        }
        return {
          satisfied: false,
          reason: `Improver disposition artifact for ${input.runId} is missing`,
        };
      }
      return isImproverDispositionCurrent(projection, artifact.applied)
        ? { satisfied: true }
        : {
            satisfied: false,
            reason:
              `Autonomy issue ${artifact.applied.issueKey} revision ` +
              `${artifact.applied.semanticRevision} changed after disposition review`,
          };
    },
  },
  description:
    "Disposition one new or materially revised durable autonomy issue and route implementation through generated work.",
  defaultAutonomyMode: "autonomous",
  triggers: [{ event: autonomyIssueDecisionRequested.name }],
  steps: [
    inspectWorktree,
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
      when: (ctx) =>
        selectIssue.output(ctx)?.eligible === true &&
        inspectWorktree.output(ctx)?.dirty === false,
    },
    applyDisposition,
    writeCommitMessage,
    validateChanges,
    writeDispositionArtifact,
    {
      id: "emit-disposition-publication",
      type: "emit",
      when: stepSucceeded("write-disposition-artifact"),
      event: IMPROVER_DISPOSITION_PUBLICATION_REQUESTED_EVENT,
      payload: (ctx) => {
        const publicationKey = improverDispositionPublicationKey(
          ctx.workflow.runId,
        );
        return {
          idempotencyKey: publicationKey,
          publicationKey,
          sourceRunId: ctx.workflow.runId,
        };
      },
    },
  ],
};

export { issueDispositionOutputSchema };
export default improverWorkflow;
