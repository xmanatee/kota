import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  applyScopeImprovementRecommendationsOperation,
  type ScopeImprovementActionResult,
} from "#modules/autonomy/workflows/scope-improver/scope-improvement.js";
import { resolveScopeImprovementAuthority } from "#modules/autonomy/workflows/scope-improver/scope-improvement-authority.js";
import type {
  ScopeImprovementInputs,
  ScopeImprovementRecommendation,
} from "#modules/autonomy/workflows/scope-improver/scope-improvement-types.js";
import { taskQueueValidationOperation } from "#modules/repo-tasks/task-queue-validation-operation.js";

type ScopeImprovementActionRequest = {
  sourceRunId: string;
  inputs: ScopeImprovementInputs;
  recommendations: ScopeImprovementRecommendation[];
};

type InspectedActionRequest = {
  request: ScopeImprovementActionRequest;
  parkedReason: string | null;
};

function decodeRequest(value: unknown): ScopeImprovementActionRequest {
  const request = expectStructuredOutput<ScopeImprovementActionRequest>(value, [
    "sourceRunId",
    "inputs",
    "recommendations",
  ]);
  if (
    typeof request.sourceRunId !== "string" ||
    !Array.isArray(request.recommendations) ||
    request.inputs.config.posture === "observe"
  ) {
    throw new Error("scope-improvement action request is invalid");
  }
  return request;
}

function decodeActions(value: unknown): ScopeImprovementActionResult {
  return expectStructuredOutput<ScopeImprovementActionResult>(value, [
    "createdTaskIds",
    "ownerQuestionIds",
    "applied",
    "requiresCommit",
    "parkedReason",
  ]);
}

const inspectRequest = typedCodeStep<InspectedActionRequest>({
  id: "inspect-request",
  type: "code",
  validate: (value) =>
    expectStructuredOutput<InspectedActionRequest>(value, [
      "request",
      "parkedReason",
    ]),
  run: ({ trigger, scopeId, scopePolicySnapshot, scopeRoot, stateDir }) => {
    if (!scopePolicySnapshot) {
      throw new Error(
        "scope-improvement actions require an authoritative resolved scope-policy snapshot",
      );
    }
    const request = decodeRequest(trigger.payload);
    if (
      request.inputs.scope.scopeId !== scopeId ||
      request.inputs.scope.directoryRoot !== scopeRoot
    ) {
      throw new Error("scope-improvement action request does not belong to this runtime scope");
    }
    let parkedReason: string | null = null;
    try {
      const authority = resolveScopeImprovementAuthority({
        scopeRoot,
        stateDir,
        policy: scopePolicySnapshot.policy,
      });
      if (!authority.enabled) {
        parkedReason =
          "scope-improvement actions are parked because continuous improvement is disabled";
      } else if (authority.taskProposalDecision.outcome !== "allow") {
        parkedReason =
          authority.taskProposalDecision.outcome === "confirm"
            ? `scope-improvement actions are parked because the current scope policy requires ` +
              `owner confirmation for task-queue writes: ${authority.taskProposalDecision.reason}`
            : `scope-improvement actions are parked because the current scope policy denies ` +
              `task-queue writes: ${authority.taskProposalDecision.reason}`;
      } else if (authority.posture === "observe") {
        parkedReason =
          "scope-improvement actions are parked because current improvement authority " +
          "permits observation and owner questions only";
      }
    } catch (error) {
      parkedReason =
        "scope-improvement actions are parked because current improvement authority " +
        `cannot be inspected: ${error instanceof Error ? error.message : String(error)}`;
    }
    return {
      request,
      parkedReason,
    };
  },
});

const applyRecommendations = typedCodeStep<ScopeImprovementActionResult>({
  id: "apply-recommendations",
  type: "code",
  validate: decodeActions,
  run: (ctx) => {
    const inspected = inspectRequest.outputRequired(ctx);
    if (inspected.parkedReason !== null) {
      return {
        createdTaskIds: [],
        ownerQuestionIds: [],
        applied: [],
        requiresCommit: false,
        parkedReason: inspected.parkedReason,
      };
    }
    const request = inspected.request;
    return ctx.runBlocking(applyScopeImprovementRecommendationsOperation, {
      workspaceRoot: ctx.workspaceRoot,
      runId: request.sourceRunId,
      inputs: request.inputs,
      recommendations: request.recommendations,
    });
  },
});

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) => applyRecommendations.outputRequired(ctx).requiresCommit,
  validate: (raw) => expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: (ctx) => {
    const actions = applyRecommendations.outputRequired(ctx);
    const lines = [
      "scope-improver: apply scoped improvement action(s)",
      "",
      ...actions.createdTaskIds.map((id) => `- create ${id}`),
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

const validateChanges = typedCodeStep<{ ok: true }>({
  id: "validate-changes",
  type: "code",
  when: (ctx) => applyRecommendations.outputRequired(ctx).requiresCommit,
  validate: (raw) => {
    const result = expectStructuredOutput<{ ok: true }>(raw, ["ok"]);
    if (result.ok !== true) throw new Error(`expected ok: true, got ${String(result.ok)}`);
    return result;
  },
  run: async (ctx) => {
    await ctx.runBlocking(taskQueueValidationOperation, {
      workspaceRoot: ctx.workspaceRoot,
    });
    await ctx.runCommand({
      command: "pnpm",
      args: ["run", "validate-tasks"],
      cwd: ctx.workspaceRoot,
    });
    return { ok: true } as const;
  },
});

const returnActions = typedCodeStep<ScopeImprovementActionResult>({
  id: "return-actions",
  type: "code",
  validate: decodeActions,
  run: (ctx) => applyRecommendations.outputRequired(ctx),
});

const workflow: WorkflowDefinitionInput = {
  name: "scope-improvement-actions",
  description:
    "Apply scope-improvement task proposals through the shared repository writer runtime.",
  repository: "write",
  integration: { validationCommand: ["pnpm", "validate-tasks"] },
  resources: ({ trigger }) => {
    const request = decodeRequest(trigger.payload);
    return request.recommendations.map((recommendation) =>
      `scope-improvement:${recommendation.signature}`
    );
  },
  inputSchema: {
    type: "object",
    required: ["sourceRunId", "inputs", "recommendations"],
    properties: {
      sourceRunId: { type: "string" },
      inputs: { type: "object" },
      recommendations: { type: "array" },
      _runId: { type: "string" },
      triggeredByRunId: { type: "string" },
    },
    additionalProperties: false,
  },
  triggers: [{ event: "workflow.triggered" }],
  steps: [
    inspectRequest,
    applyRecommendations,
    writeCommitMessage,
    validateChanges,
    returnActions,
  ],
};

export default workflow;
