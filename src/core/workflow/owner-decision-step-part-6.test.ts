import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApprovalQueue,
  resetApprovalQueue,
  setApprovalQueueInstance,
} from "#core/daemon/approval-queue.js";
import { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import {
  resetIdempotencyStore,
  setIdempotencyStoreInstance,
} from "#core/daemon/idempotency-singleton.js";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { OwnerDecisionStore } from "#core/daemon/owner-decision-store.js";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { type EventBus, initEventBus, resetEventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
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

const TRIGGER: WorkflowRunTrigger = { event: "manual", schemaRef: null, payload: {} };

const ACTION = {
  actionId: "book-court",
  adapterName: "sports-booking",
  description: "Book the selected sports slot",
  dryRun: false,
  requiresConfirmation: true,
  dangerousEffect: true,
  authorizingSelection: { kind: "single-choice" as const, optionId: "yes" },
};

type ConfirmedActionFixtureOptions = {
  includeApproval: boolean;
  failAdapter?: boolean;
};

describe("owner decision workflow helpers", () => {
  let projectDir: string;
  let decisionDir: string;
  let questionDir: string;
  let approvalDir: string;
  let deadLetterDir: string;
  let idempotencyDir: string;
  let bus: EventBus;
  let pbus: ProjectScopedEventBus;
  let store: WorkflowRunStore;
  let decisionStore: OwnerDecisionStore;
  let questionQueue: OwnerQuestionQueue;
  let approvalQueue: ApprovalQueue;
  let _deadLetterQueue: DeadLetterQueueStore;
  let idempotencyStore: IdempotencyStore;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "owner-decision-workflow-"));
    decisionDir = mkdtempSync(join(tmpdir(), "owner-decision-store-"));
    questionDir = mkdtempSync(join(tmpdir(), "owner-decision-question-"));
    approvalDir = mkdtempSync(join(tmpdir(), "owner-decision-approval-"));
    deadLetterDir = mkdtempSync(join(tmpdir(), "owner-decision-dlq-"));
    idempotencyDir = mkdtempSync(join(tmpdir(), "owner-decision-idempotency-"));
    resetEventBus();
    bus = initEventBus();
    pbus = new ProjectScopedEventBus(bus, "scope-a");
    store = new WorkflowRunStore(projectDir);
    decisionStore = new OwnerDecisionStore(decisionDir, "scope-a", pbus);
    questionQueue = new OwnerQuestionQueue(questionDir, pbus);
    approvalQueue = new ApprovalQueue(approvalDir, pbus);
    _deadLetterQueue = new DeadLetterQueueStore(deadLetterDir);
    idempotencyStore = new IdempotencyStore(idempotencyDir, "scope-a");
    setApprovalQueueInstance(approvalQueue);
    setIdempotencyStoreInstance(idempotencyStore);
    log.mockReset();
  });

  afterEach(() => {
    resetApprovalQueue();
    resetIdempotencyStore();
    resetEventBus();
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(decisionDir, { recursive: true, force: true });
    rmSync(questionDir, { recursive: true, force: true });
    rmSync(approvalDir, { recursive: true, force: true });
    rmSync(deadLetterDir, { recursive: true, force: true });
    rmSync(idempotencyDir, { recursive: true, force: true });
  });

  function _makeDataOnlyWorkflow(): WorkflowDefinition {
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
    decisionAction: typeof ACTION = ACTION,
    adapterAction: typeof ACTION = decisionAction,
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
    const approvalIdResolver =
      options.includeApproval
        ? (ctx: WorkflowStepContext) => (ctx.stepOutputs.approval as { approvalId: string }).approvalId
        : undefined;
    const action = confirmedOwnerActionStep({
      id: "book",
      decisionStore: () => decisionStore,
      approvalQueue: () => approvalQueue,
      idempotencyStore: () => idempotencyStore,
      decisionId: (ctx) => decision.consume.outputRequired(ctx).decisionId,
      ...(approvalIdResolver === undefined ? {} : { approvalId: approvalIdResolver }),
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
      definitionPath: "src/core/workflow/owner-decision-step.test.ts",
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
      project: { id: "scope-a", root: projectDir },
      workflow: "owner-decision-fixture",
      trigger: TRIGGER,
      sandbox: {
        runId,
        repository: "none",
        rootDir: projectDir,
        workspaceDir: projectDir,
        tempDir: projectDir,
        artifactDir: projectDir,
      },
      resources: {
        runId,
        attempt: 1,
        daemonEpoch: 1,
        workspaceDir: projectDir,
        runDir: projectDir,
        tempDir: projectDir,
        artifactDir: projectDir,
        agentDir: projectDir,
        packageCacheDir: projectDir,
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

  it("confirmed external action fixture rejects a non-authorizing owner answer before executing", async () => {
    const calls: string[] = [];
    const definition = makeConfirmedActionWorkflow(calls);
    const { promise } = executeWorkflowRun(
      definition,
      TRIGGER,
      runExecutorDeps(),
    );

    await answerPendingQuestion("no");
    await approvePendingApproval();
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(calls).toEqual([]);
    const action = result.metadata.steps.find((step) => step.id === "book")!;
    expect(action.status).toBe("failed");
    expect(action.error).toContain("selected value does not authorize action book-court");
    expect(decisionStore.list("consumed")).toEqual([]);
    expect(decisionStore.list("answered").map((decision) => decision.selectedValue)).toEqual([
      { kind: "single-choice", optionId: "no" },
    ]);
  });});
