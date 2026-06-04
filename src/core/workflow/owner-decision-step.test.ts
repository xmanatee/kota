import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApprovalQueue,
  resetApprovalQueue,
  setApprovalQueueInstance,
} from "#core/daemon/approval-queue.js";
import { OwnerDecisionStore } from "#core/daemon/owner-decision-store.js";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { type EventBus, initEventBus, resetEventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { confirmedOwnerActionStep } from "./owner-confirmed-action-step.js";
import { type AwaitedOwnerDecisionOutcome, ownerDecisionSteps } from "./owner-decision-step.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowStepContext } from "./run-types.js";
import type { WorkflowApprovalStep } from "./step-types.js";
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
};

describe("owner decision workflow helpers", () => {
  let projectDir: string;
  let decisionDir: string;
  let questionDir: string;
  let approvalDir: string;
  let bus: EventBus;
  let pbus: ProjectScopedEventBus;
  let store: WorkflowRunStore;
  let decisionStore: OwnerDecisionStore;
  let questionQueue: OwnerQuestionQueue;
  let approvalQueue: ApprovalQueue;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "owner-decision-workflow-"));
    decisionDir = mkdtempSync(join(tmpdir(), "owner-decision-store-"));
    questionDir = mkdtempSync(join(tmpdir(), "owner-decision-question-"));
    approvalDir = mkdtempSync(join(tmpdir(), "owner-decision-approval-"));
    resetEventBus();
    bus = initEventBus();
    pbus = new ProjectScopedEventBus(bus, "scope-a");
    store = new WorkflowRunStore(projectDir);
    decisionStore = new OwnerDecisionStore(decisionDir, "scope-a", pbus);
    questionQueue = new OwnerQuestionQueue(questionDir, pbus);
    approvalQueue = new ApprovalQueue(approvalDir, pbus);
    setApprovalQueueInstance(approvalQueue);
    log.mockReset();
  });

  afterEach(() => {
    resetApprovalQueue();
    resetEventBus();
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(decisionDir, { recursive: true, force: true });
    rmSync(questionDir, { recursive: true, force: true });
    rmSync(approvalDir, { recursive: true, force: true });
  });

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
      recoveryCapable: false,
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
      decisionId: (ctx) => decision.consume.outputRequired(ctx).decisionId,
      ...(approvalIdResolver === undefined ? {} : { approvalId: approvalIdResolver }),
      input: { slot: "7pm" },
      adapter: {
        metadata: adapterAction,
        execute: ({ input }) => {
          calls.push(String(input.slot));
          return { ok: true, slot: String(input.slot) };
        },
      },
    });
    return {
      name: "owner-decision-action-fixture",
      enabled: true,
      recoveryCapable: false,
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
        approvalQueue.approve(pending[0].id, "approved in test", "test");
        return pending[0].id;
      }
    }
    throw new Error("approval was not enqueued");
  }

  it("data-only fixture persists a selected owner decision after workflow resume", async () => {
    const definition = makeDataOnlyWorkflow();
    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });

    await answerPendingQuestion("module");
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    const outcome = result.metadata.steps.find((step) => step.id === "choose-consume")!
      .output as AwaitedOwnerDecisionOutcome;
    expect(outcome.kind).toBe("answered");
    if (outcome.kind === "answered") {
      expect(outcome.selectedValue).toEqual({ kind: "single-choice", optionId: "module" });
      expect(decisionStore.get(outcome.decisionId)?.status).toBe("answered");
    }
  });

  it("confirmed external action fixture executes only after decision and approval", async () => {
    const calls: string[] = [];
    const definition = makeConfirmedActionWorkflow(calls);
    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });

    await answerPendingQuestion("yes");
    const approvalId = await approvePendingApproval();
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(calls).toEqual(["7pm"]);
    const action = result.metadata.steps.find((step) => step.id === "book")!;
    expect(action.status).toBe("success");
    expect(action.output).toMatchObject({ actionId: "book-court", approvalId });
    const consumed = decisionStore.list("consumed")[0];
    expect(consumed.consumption?.approvalId).toBe(approvalId);
  });

  it("confirmed external action fixture rejects a non-authorizing owner answer before executing", async () => {
    const calls: string[] = [];
    const definition = makeConfirmedActionWorkflow(calls);
    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });

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
  });

  it("does not let adapter metadata override the persisted action authorization", async () => {
    const calls: string[] = [];
    const adapterAction = {
      ...ACTION,
      authorizingSelection: { kind: "single-choice" as const, optionId: "no" },
    };
    const definition = makeConfirmedActionWorkflow(calls, ACTION, adapterAction);
    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });

    await answerPendingQuestion("no");
    await approvePendingApproval();
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(calls).toEqual([]);
    const action = result.metadata.steps.find((step) => step.id === "book")!;
    expect(action.status).toBe("failed");
    expect(action.error).toContain("authorizes a different selected value");
    expect(decisionStore.list("consumed")).toEqual([]);
  });

  it("does not let adapter metadata downgrade a persisted dangerous action", async () => {
    const calls: string[] = [];
    const adapterAction = {
      ...ACTION,
      dangerousEffect: false,
    };
    const definition = makeConfirmedActionWorkflow(calls, ACTION, adapterAction, { includeApproval: false });
    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });

    await answerPendingQuestion("yes");
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(calls).toEqual([]);
    const action = result.metadata.steps.find((step) => step.id === "book")!;
    expect(action.status).toBe("failed");
    expect(action.error).toContain("authorizes a different dangerous-effect posture");
    expect(decisionStore.list("consumed")).toEqual([]);
  });

  it("does not let adapter metadata change the persisted dry-run mode", async () => {
    const calls: string[] = [];
    const decisionAction = {
      ...ACTION,
      dryRun: true,
      dangerousEffect: false,
    };
    const adapterAction = {
      ...decisionAction,
      dryRun: false,
    };
    const definition = makeConfirmedActionWorkflow(calls, decisionAction, adapterAction, { includeApproval: false });
    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });

    await answerPendingQuestion("yes");
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(calls).toEqual([]);
    const action = result.metadata.steps.find((step) => step.id === "book")!;
    expect(action.status).toBe("failed");
    expect(action.error).toContain("authorizes a different dry-run mode");
    expect(decisionStore.list("consumed")).toEqual([]);
  });
});
