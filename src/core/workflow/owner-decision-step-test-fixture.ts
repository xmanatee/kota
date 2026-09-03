import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { OwnerDecisionStore } from "#core/daemon/owner-decision-store.js";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import { confirmedOwnerActionStep } from "./owner-confirmed-action-step.js";
import { ownerDecisionSteps } from "./owner-decision-step.js";
import {
  executeWorkflowRun,
  type RunExecutorDeps,
} from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowStepContext } from "./run-types.js";
import type { WorkflowApprovalStep } from "./step-types.js";
import { createTestTransactionalRunState } from "./testing/run-context-fixture.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export const OWNER_DECISION_TRIGGER: WorkflowRunTrigger = {
  event: "manual",
  schemaRef: null,
  payload: {},
};

export const OWNER_ACTION = {
  actionId: "book-court",
  adapterName: "sports-booking",
  description: "Book the selected sports slot",
  dryRun: false,
  requiresConfirmation: true,
  dangerousEffect: true,
  authorizingSelection: { kind: "single-choice" as const, optionId: "yes" },
};

export type ConfirmedActionFixtureOptions = {
  includeApproval: boolean;
  failAdapter?: boolean;
};

export type OwnerDecisionWorkflowFixture = ReturnType<
  typeof createOwnerDecisionWorkflowFixture
>;

export function createOwnerDecisionWorkflowFixture() {
  const root = mkdtempSync(join(tmpdir(), "owner-decision-workflow-"));
  const bus = new EventBus();
  const pbus = new ScopedEventBus(bus, "scope-a");
  const store = new WorkflowRunStore(root);
  const decisionStore = new OwnerDecisionStore(join(root, "decisions"), "scope-a", pbus);
  const questionQueue = new OwnerQuestionQueue(join(root, "questions"), pbus);
  const approvalQueue = new ApprovalQueue(join(root, "approvals"), pbus);
  const deadLetterQueue = new DeadLetterQueueStore(join(root, "dead-letters"));
  const idempotencyStore = new IdempotencyStore(join(root, "idempotency"), "scope-a");
  const log = vi.fn<(message: string) => void>();

  function makeDataOnlyWorkflow(): WorkflowDefinition {
    const decision = ownerDecisionSteps({
      idPrefix: "choose",
      decisionStore: () => decisionStore,
      ownerQuestionQueue: () => questionQueue,
      input: {
        context: "A workflow needs an auditable data-only architecture choice.",
        reason: "The selected architecture persists beyond this run.",
        request: {
          kind: "single-choice",
          prompt: "Which architecture option should be recorded?",
          options: [
            { id: "module", label: "Module owned" },
            { id: "core", label: "Core owned" },
          ],
        },
      },
    });
    return {
      name: "owner-decision-data-fixture",
      enabled: true,
      repository: "none",
      definitionPath: "src/core/workflow/owner-decision-step.test.ts",
      moduleRoot: "/test-module-root",
      triggers: [],
      steps: [decision.ask, decision.wait, decision.consume],
      tags: [],
    };
  }

  function makeConfirmedActionWorkflow(
    calls: string[],
    decisionAction: typeof OWNER_ACTION = OWNER_ACTION,
    adapterAction: typeof OWNER_ACTION = decisionAction,
    options: ConfirmedActionFixtureOptions = { includeApproval: true },
  ): WorkflowDefinition {
    const decision = ownerDecisionSteps({
      idPrefix: "confirm",
      decisionStore: () => decisionStore,
      ownerQuestionQueue: () => questionQueue,
      input: {
        context: "A channel opportunity workflow needs owner confirmation before booking.",
        reason: "The external booking is a non-read side effect.",
        request: {
          kind: "single-choice",
          prompt: "Book the 7pm slot?",
          options: [
            { id: "yes", label: "Book it" },
            { id: "no", label: "Do not book" },
          ],
        },
        action: decisionAction,
      },
    });
    const approval: WorkflowApprovalStep = {
      id: "approval",
      type: "approval",
      reason: "Execute the confirmed sports-booking action",
      defaultResolution: "deny",
    };
    const approvalId = options.includeApproval
      ? (ctx: WorkflowStepContext) =>
          (ctx.stepOutputs.approval as { approvalId: string }).approvalId
      : undefined;
    const action = confirmedOwnerActionStep({
      id: "book",
      decisionStore: () => decisionStore,
      approvalQueue: () => approvalQueue,
      idempotencyStore: () => idempotencyStore,
      decisionId: (ctx) => decision.consume.outputRequired(ctx).decisionId,
      ...(approvalId === undefined ? {} : { approvalId }),
      input: { slot: "7pm" },
      adapter: {
        metadata: adapterAction,
        execute: ({ input }) => {
          calls.push(String(input.slot));
          if (options.failAdapter) {
            throw new Error("booking provider rejected confirmed action");
          }
          return { ok: true, slot: String(input.slot) };
        },
      },
    });
    return {
      name: "owner-decision-action-fixture",
      enabled: true,
      repository: "none",
      definitionPath: "src/core/workflow/owner-confirmed-action-step.test.ts",
      moduleRoot: "/test-module-root",
      triggers: [],
      steps: [
        decision.ask,
        decision.wait,
        decision.consume,
        ...(options.includeApproval ? [approval] : []),
        action,
      ],
      tags: [],
    };
  }

  async function answerPendingQuestion(answer: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const pending = questionQueue.list("pending");
      if (pending.length === 1) {
        questionQueue.answer(pending[0].id, answer, "test");
        return;
      }
    }
    throw new Error("owner question was not enqueued");
  }

  async function approvePendingApproval(): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const pending = approvalQueue.list("pending");
      if (pending.length === 1) {
        const selection = approvalQueue.getExecutionSnapshot(pending[0].id);
        if (!selection.ok) throw new Error("approval input was unavailable");
        const result = approvalQueue.approveForExecution(
          selection.snapshot.descriptor,
          "approved in test",
          "test",
        );
        if (!result.ok) throw new Error("approval changed before execution");
        return pending[0].id;
      }
    }
    throw new Error("approval was not enqueued");
  }

  function runContext(): RunExecutorDeps["runContext"] {
    const runId = `owner-decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      run: { id: runId, attempt: 1, daemonEpoch: 1 },
      scope: { id: "scope-a", root },
      workflow: "owner-decision-fixture",
      trigger: OWNER_DECISION_TRIGGER,
      sandbox: {
        runId,
        repository: "none",
        rootDir: root,
        workspaceDir: root,
        tempDir: root,
        artifactDir: root,
      },
      resources: {
        runId,
        attempt: 1,
        daemonEpoch: 1,
        workspaceDir: root,
        runDir: root,
        tempDir: root,
        artifactDir: root,
        agentDir: root,
        packageCacheDir: root,
        ports: { start: 41_000, end: 41_000, size: 1, values: [41_000] },
        env: {},
      },
      signal: new AbortController().signal,
      processes: { register: vi.fn() },
      effects: { execute: (effect) => effect.execute() },
      publications: { stageEmit: vi.fn() },
      state: createTestTransactionalRunState(),
    };
  }

  function runExecutorDeps(
    overrides: Partial<RunExecutorDeps> = {},
  ): RunExecutorDeps {
    return {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext: runContext(),
      bus,
      pbus,
      store,
      approvalQueue,
      idempotencyStore,
      log,
      ...overrides,
    };
  }

  return {
    root,
    approvalQueue,
    deadLetterQueue,
    decisionStore,
    idempotencyStore,
    makeDataOnlyWorkflow,
    makeConfirmedActionWorkflow,
    answerPendingQuestion,
    approvePendingApproval,
    runExecutorDeps,
    execute(
      definition: WorkflowDefinition,
      trigger = OWNER_DECISION_TRIGGER,
      overrides: Partial<RunExecutorDeps> = {},
    ) {
      return executeWorkflowRun(definition, trigger, runExecutorDeps(overrides));
    },
    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
