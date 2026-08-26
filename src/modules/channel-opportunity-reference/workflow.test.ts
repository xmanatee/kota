import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import {
  resetIdempotencyStore,
  setIdempotencyStoreInstance,
} from "#core/daemon/idempotency-singleton.js";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import {
  OwnerDecisionStore,
  resetOwnerDecisionStore,
  setOwnerDecisionStoreInstance,
} from "#core/daemon/owner-decision-store.js";
import {
  OwnerQuestionQueue,
  resetOwnerQuestionQueue,
  setOwnerQuestionQueueInstance,
} from "#core/daemon/owner-question-queue.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import type {
  OwnerConfirmedActionStepOutput,
} from "#core/workflow/owner-confirmed-action-step.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type {
  WorkflowRunExecutionResult,
  WorkflowStepResult,
} from "#core/workflow/run-types.js";
import { createTestRunContext } from "#core/workflow/testing/run-context-fixture.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowBatchFlushPayload,
  type WorkflowRunTrigger,
} from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "#core/workflow/validation.js";
import {
  dispatchInboundSignalRoute,
  validateInboundSignalRoutingConfig,
} from "#modules/inbound-signals/routing.js";
import {
  buildChannelOpportunityReferenceWorkflow,
  type CalendarAvailabilityOutput,
  CHANNEL_OPPORTUNITY_REFERENCE_WORKFLOW_NAME,
  type ChannelOpportunityRunArtifact,
  type CheapClassificationOutput,
  checkCalendarAvailability,
  classifyChannelOpportunities,
  type OwnerDecisionPreparation,
  prepareOwnerDecision,
  REFERENCE_CALENDAR_BUSY_WINDOWS,
  REFERENCE_EXPECTED_OUTPUT,
  REFERENCE_TELEGRAM_BATCH,
  REFERENCE_TELEGRAM_SIGNALS,
  type ReferenceProviderActionResult,
  type RoutedOpportunitySignal,
  readChannelOpportunityBatch,
  referenceTelegramSportsRouteConfig,
  screenLikelyOpportunities,
} from "./index.js";

const SCOPE_ID = "scope-redacted";

type RunOptions = {
  batch: WorkflowBatchFlushPayload;
  answer?: "accept" | "decline";
  failProviderActionIds?: readonly string[];
};

describe("channel opportunity reference route", () => {
  it("declares a source-specific Telegram route with workflow batching", () => {
    const route = referenceTelegramSportsRouteConfig();
    const validation = validateInboundSignalRoutingConfig(
      { routes: [route] },
      {
        workflowNames: new Set([CHANNEL_OPPORTUNITY_REFERENCE_WORKFLOW_NAME]),
        agentNames: new Set(),
      },
    );

    expect(validation).toMatchObject({ ok: true });
    expect(route).toMatchObject({
      provider: "telegram",
      channel: "telegram.group",
      sourceId: "telegram:redacted-sports-community",
      targets: [
        {
          kind: "workflow",
          name: CHANNEL_OPPORTUNITY_REFERENCE_WORKFLOW_NAME,
          batch: {
            mode: "workflow-trigger",
            maxItems: 6,
            maxBufferSize: 30,
            overflow: "flush-oldest",
            groupBy: ["channel", "sourceId"],
          },
        },
      ],
      processing: {
        classifier: "cheap",
        modelTier: "capable",
        allowNonReadActions: true,
      },
    });
  });

  it("keeps blocked sources audit-only before workflow batching", async () => {
    const route = { ...referenceTelegramSportsRouteConfig(), sourceStatus: "blocked" as const };
    const batchWorkflow = vi.fn();
    const routed: unknown[] = [];

    await dispatchInboundSignalRoute({
      config: { routes: [route] },
      signal: REFERENCE_TELEGRAM_SIGNALS[1].signal,
      context: {
        workflowNames: new Set([CHANNEL_OPPORTUNITY_REFERENCE_WORKFLOW_NAME]),
        agentNames: new Set(),
      },
      deps: {
        triggerWorkflow: vi.fn(),
        batchWorkflow,
        emitRouted: (payload) => routed.push(payload),
      },
    });

    expect(batchWorkflow).not.toHaveBeenCalled();
    expect(routed).toEqual([
      expect.objectContaining({
        decision: "blocked",
        reason: "source status is blocked; route is audit-only",
        targets: [
          expect.objectContaining({
            status: "skipped",
            name: CHANNEL_OPPORTUNITY_REFERENCE_WORKFLOW_NAME,
          }),
        ],
      }),
    ]);
  });
});

describe("channel opportunity reference fixture", () => {
  it("produces the expected structured outputs from the redacted batch fixture", () => {
    const batch = readChannelOpportunityBatch(REFERENCE_TELEGRAM_BATCH);
    const cheap = classifyChannelOpportunities(batch);
    const screened = screenLikelyOpportunities(cheap);
    const calendar = checkCalendarAvailability(
      screened,
      REFERENCE_CALENDAR_BUSY_WINDOWS,
    );
    const decision = prepareOwnerDecision(calendar);

    expect(batch.signals).toHaveLength(REFERENCE_EXPECTED_OUTPUT.inputCount);
    expect(cheap.candidateCount).toBe(
      REFERENCE_EXPECTED_OUTPUT.cheapCandidateCount,
    );
    expect(screened.candidates).toHaveLength(
      REFERENCE_EXPECTED_OUTPUT.screenedCandidateCount,
    );
    expect(calendar.available.map((candidate) => candidate.id)).toEqual(
      REFERENCE_EXPECTED_OUTPUT.calendarAvailableOpportunityIds,
    );
    expect(calendar.rejected.map((item) => item.reason)).toEqual(
      expect.arrayContaining(REFERENCE_EXPECTED_OUTPUT.rejectedReasons),
    );
    expect(decision).toMatchObject({
      status: "needs-owner",
      selectedCandidate: {
        id: "padel-redacted-fit",
        providerAction: {
          actionId: REFERENCE_EXPECTED_OUTPUT.providerActionId,
        },
      },
    });
  });
});

describe("channel opportunity reference workflow", () => {
  let projectDir: string;
  let decisionStore: OwnerDecisionStore;
  let questionQueue: OwnerQuestionQueue;
  let idempotencyStore: IdempotencyStore;
  let deadLetterQueue: DeadLetterQueueStore;
  let runStore: WorkflowRunStore;
  let bus: EventBus;
  let pbus: ProjectScopedEventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "channel-opportunity-reference-"));
    bus = new EventBus();
    pbus = new ProjectScopedEventBus(bus, SCOPE_ID);
    decisionStore = new OwnerDecisionStore(
      join(projectDir, "owner-decisions"),
      SCOPE_ID,
      pbus,
    );
    questionQueue = new OwnerQuestionQueue(
      join(projectDir, "owner-questions"),
      pbus,
    );
    idempotencyStore = new IdempotencyStore(
      join(projectDir, "idempotency"),
      SCOPE_ID,
    );
    deadLetterQueue = new DeadLetterQueueStore(join(projectDir, "dead-letters"));
    runStore = new WorkflowRunStore(projectDir);
    setOwnerDecisionStoreInstance(decisionStore);
    setOwnerQuestionQueueInstance(questionQueue);
    setIdempotencyStoreInstance(idempotencyStore);
    log.mockReset();
  });

  afterEach(() => {
    resetOwnerDecisionStore();
    resetOwnerQuestionQueue();
    resetIdempotencyStore();
    rmSync(projectDir, { recursive: true, force: true });
  });

  function definition(options: RunOptions): WorkflowDefinition {
    const input = buildChannelOpportunityReferenceWorkflow({
      calendarBusyWindows: REFERENCE_CALENDAR_BUSY_WINDOWS,
      failProviderActionIds: options.failProviderActionIds,
    });
    return {
      ...input,
      enabled: true,
      repository: input.repository ?? "none",
      definitionPath: "src/modules/channel-opportunity-reference/workflow.ts",
      moduleRoot: process.cwd(),
      tags: input.tags ?? [],
      triggers: [],
      steps: input.steps as WorkflowDefinition["steps"],
    };
  }

  it("contributes a valid route-owned workflow definition", () => {
    const input = buildChannelOpportunityReferenceWorkflow({
      calendarBusyWindows: REFERENCE_CALENDAR_BUSY_WINDOWS,
    });
    const [validated] = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition(
          "src/modules/channel-opportunity-reference/workflow.ts",
          input,
        ),
      ],
      projectDir,
    );

    expect(validated).toBeDefined();
    expect(validated!.triggers).toEqual([
      expect.objectContaining({ event: "manual.channel-opportunity-reference" }),
    ]);
  });

  function trigger(batch: WorkflowBatchFlushPayload): WorkflowRunTrigger {
    return {
      event: WORKFLOW_BATCH_FLUSH_EVENT,
      schemaRef: null,
      payload: batch,
    };
  }

  function payloadFor(signal: RoutedOpportunitySignal) {
    return {
      scopeId: SCOPE_ID,
      projectId: SCOPE_ID,
      routeId: signal.routeId,
      decision: "dispatched",
      sourceStatus: signal.sourceStatus,
      provider: signal.provider,
      channel: signal.channel,
      accountId: signal.accountId,
      sourceId: signal.sourceId,
      actorTrust: signal.actorTrust,
      policy: {
        routeId: signal.routeId,
        sourceStatus: signal.sourceStatus,
        blockedHandling: "audit-only",
        batch: null,
        processing: null,
      },
      signal: signal.signal,
      target: {
        kind: "workflow",
        name: CHANNEL_OPPORTUNITY_REFERENCE_WORKFLOW_NAME,
      },
    };
  }

  function batchWithSignals(signals: readonly RoutedOpportunitySignal[]): WorkflowBatchFlushPayload {
    return {
      ...REFERENCE_TELEGRAM_BATCH,
      count: signals.length,
      inputEvents: signals.map((signal, index) => ({
        event: "inbound.signal.received",
        schemaRef: { name: "inbound.signal.received", version: 1 },
        eventId: `test-event-${index + 1}`,
        receivedAt: "2026-06-19T12:00:00.000Z",
        payload: payloadFor(signal),
      })),
      batch: {
        ...REFERENCE_TELEGRAM_BATCH.batch,
        droppedInputCount: 0,
      },
    };
  }

  async function answerPendingQuestion(answer: "accept" | "decline"): Promise<void> {
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

  async function runReference(
    options: RunOptions,
  ): Promise<WorkflowRunExecutionResult> {
    const run = executeWorkflowRun(definition(options), trigger(options.batch), {
      runContext: createTestRunContext(projectDir, trigger(options.batch)),
      bus,
      pbus,
      store: runStore,
      deadLetterQueue,
      log,
    });
    if (options.answer) await answerPendingQuestion(options.answer);
    return await run.promise;
  }

  function output<T>(result: WorkflowRunExecutionResult, stepId: string): T {
    const step = result.metadata.steps.find((candidate) => candidate.id === stepId);
    if (!step) throw new Error(`missing step ${stepId}`);
    return step.output as T;
  }

  function step(result: WorkflowRunExecutionResult, stepId: string): WorkflowStepResult {
    const found = result.metadata.steps.find((candidate) => candidate.id === stepId);
    if (!found) throw new Error(`missing step ${stepId}`);
    return found;
  }

  it("no-ops an empty batch without asking the owner", async () => {
    const result = await runReference({
      batch: batchWithSignals([]),
    });

    expect(result.metadata.status).toBe("success");
    expect(questionQueue.list()).toHaveLength(0);
    expect(output<OwnerDecisionPreparation>(result, "prepare-owner-decision")).toMatchObject({
      status: "none",
    });
    expect(step(result, "owner-confirm-ask").status).toBe("skipped");
  });

  it("ignores blocked or archived source entries inside a batch", async () => {
    const result = await runReference({
      batch: batchWithSignals([REFERENCE_TELEGRAM_SIGNALS[4]]),
    });

    expect(result.metadata.status).toBe("success");
    expect(questionQueue.list()).toHaveLength(0);
    expect(output<CheapClassificationOutput>(result, "cheap-classify").rejected).toEqual([
      expect.objectContaining({ reason: "source-not-active" }),
    ]);
  });

  it("rejects noisy messages in the cheap classifier", async () => {
    const result = await runReference({
      batch: batchWithSignals([REFERENCE_TELEGRAM_SIGNALS[0]]),
    });

    expect(result.metadata.status).toBe("success");
    expect(questionQueue.list()).toHaveLength(0);
    expect(output<CheapClassificationOutput>(result, "cheap-classify")).toMatchObject({
      candidateCount: 0,
      rejected: [expect.objectContaining({ reason: "cheap-reject" })],
    });
  });

  it("does not ask the owner when the calendar conflicts", async () => {
    const result = await runReference({
      batch: batchWithSignals([REFERENCE_TELEGRAM_SIGNALS[2]]),
    });

    expect(result.metadata.status).toBe("success");
    expect(questionQueue.list()).toHaveLength(0);
    expect(output<CalendarAvailabilityOutput>(result, "check-calendar-availability")).toMatchObject({
      checkedCount: 1,
      available: [],
      rejected: [expect.objectContaining({ reason: "calendar-conflict" })],
    });
  });

  it("records owner decline without executing the provider action", async () => {
    const result = await runReference({
      batch: REFERENCE_TELEGRAM_BATCH,
      answer: "decline",
    });

    expect(result.metadata.status).toBe("success");
    expect(decisionStore.list("answered")).toHaveLength(1);
    expect(decisionStore.list("answered")[0].selectedValue).toEqual({
      kind: "single-choice",
      optionId: "decline",
    });
    expect(decisionStore.list("consumed")).toHaveLength(0);
    expect(step(result, "execute-provider-action-dry-run").status).toBe("skipped");
    expect(output<ChannelOpportunityRunArtifact>(result, "record-reference-artifact").providerAction).toBeNull();
  });

  it("executes a fake provider action after owner acceptance", async () => {
    const result = await runReference({
      batch: REFERENCE_TELEGRAM_BATCH,
      answer: "accept",
    });

    expect(result.metadata.status).toBe("success");
    expect(decisionStore.list("consumed")).toHaveLength(1);
    expect(
      output<OwnerConfirmedActionStepOutput<ReferenceProviderActionResult>>(
        result,
        "execute-provider-action-dry-run",
      ).result.ok,
    ).toBe(true);
    const artifact = output<ChannelOpportunityRunArtifact>(
      result,
      "record-reference-artifact",
    );
    expect(existsSync(artifact.artifactPath)).toBe(true);
    expect(artifact.providerAction).toMatchObject({
      providerAdapter: "telegram-reaction",
      providerActionId: REFERENCE_EXPECTED_OUTPUT.providerActionId,
      dryRun: true,
    });
  });

  it("dead-letters fake provider action failures", async () => {
    const result = await runReference({
      batch: REFERENCE_TELEGRAM_BATCH,
      answer: "accept",
      failProviderActionIds: [REFERENCE_EXPECTED_OUTPUT.providerActionId],
    });

    expect(result.metadata.status).toBe("failed");
    expect(deadLetterQueue.list()).toEqual([
      expect.objectContaining({
        type: "confirmed-action-dispatch",
        status: "open",
        owningModule: "channel-opportunity-reference",
        failure: expect.objectContaining({
          reason: `dry-run provider action failed: ${REFERENCE_EXPECTED_OUTPUT.providerActionId}`,
        }),
      }),
    ]);
  });

  it("persists the rendered owner confirmation evidence in the run artifact", async () => {
    const result = await runReference({
      batch: REFERENCE_TELEGRAM_BATCH,
      answer: "accept",
    });
    const artifact = output<ChannelOpportunityRunArtifact>(
      result,
      "record-reference-artifact",
    );
    const rendered = readFileSync(artifact.artifactPath, "utf-8");

    expect(rendered).toContain("Join this padel opportunity?");
    expect(rendered).toContain("telegram-react-padel-redacted-fit");
    expect(rendered).toContain("\"providerAction\"");
  });
});
