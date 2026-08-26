import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { createTestWorkflowRuntime } from "#core/workflow/testing/runtime-fixture.js";
import { handleRejectApproval } from "#modules/approval-queue/routes.js";
import { handleAnswerOwnerQuestion } from "#modules/owner-questions/routes.js";
import {
  APPROVAL_WORDS,
  allWorkflows,
  approvalLikeText,
  type DeliveredWorkflow,
  dispatchInboundDelivery,
  expectPromptsPending,
  makePromptQueues,
  mockRequest,
  mockResponse,
  seedApproval,
  seedOwnerQuestion,
  waitUntil,
} from "./operator-authorization-boundary-fixture.integration.js";

describe("operator authorization boundary", () => {
  let scopeRoot: string;
  const runStates: Array<{ close(): void }> = [];

  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-operator-boundary-"));
  });

  afterEach(() => {
    for (const runState of runStates.splice(0)) runState.close();
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("keeps scheduled, webhook, and inbound-signal workflow payload text from resolving operator prompts", async () => {
    const bus = new EventBus();
    const scopeId = deriveDirectoryScopeId(scopeRoot);
    const pbus = new ScopedEventBus(bus, scopeId);
    const { approvalQueue, ownerQuestionQueue } = makePromptQueues(scopeRoot, pbus);
    const approval = seedApproval(approvalQueue);
    const ownerQuestion = seedOwnerQuestion(ownerQuestionQueue);
    const text = approvalLikeText(approval.id, ownerQuestion.id);
    const delivered: DeliveredWorkflow[] = [];
    const workflowStartedScopes: Array<string | undefined> = [];
    bus.on("workflow.started", (payload) => {
      const scopedPayload = payload as typeof payload & { scopeId?: string };
      workflowStartedScopes.push(scopedPayload.scopeId);
    });

    const { runtime, runState } = createTestWorkflowRuntime({
      bus,
      scopeRoot,
      idleIntervalMs: 60_000,
      workflows: allWorkflows(delivered, text),
    });
    runStates.push(runState);
    runtime.start();
    await waitUntil(
      () => delivered.some((item) => item.source === "schedule"),
      "scheduled workflow did not run",
    );
    expectPromptsPending(approvalQueue, ownerQuestionQueue, approval.id, ownerQuestion.id);

    const webhookResult = runtime.enqueueWebhookRun("webhook-operator-boundary", {
      body: { text, answer: "yes", ownerQuestionId: ownerQuestion.id },
      headers: { "x-kota-test": "authorization-boundary" },
      timestamp: new Date().toISOString(),
      idempotencyKey: `operator-boundary-${approval.id}`,
    });
    expect(webhookResult.ok).toBe(true);
    await waitUntil(
      () => delivered.some((item) => item.source === "webhook"),
      "webhook workflow did not run",
    );
    expectPromptsPending(approvalQueue, ownerQuestionQueue, approval.id, ownerQuestion.id);
    const routedPayloads: unknown[] = [];
    await dispatchInboundDelivery({
      scopeRoot,
      pbus,
      scopeId,
      text,
      routedPayloads,
      triggerWorkflow: async (name, options) => {
        const result = runtime.enqueuePendingRun(name, options);
        return result.ok
          ? { ok: true, path: "daemon", queued: name, ...(result.runId ? { runId: result.runId } : {}) }
          : { ok: false, reason: result.alreadyQueued ? "already_queued" : "daemon_required" };
      },
    });
    await waitUntil(
      () => delivered.some((item) => item.source === "inbound-signal"),
      "inbound-signal workflow did not run",
    );
    await runtime.stop();

    expect(routedPayloads).toHaveLength(1);
    expectPromptsPending(approvalQueue, ownerQuestionQueue, approval.id, ownerQuestion.id);
    expect(delivered.every((item) => item.payloadText.includes(APPROVAL_WORDS))).toBe(true);
    expect(delivered.map((item) => item.source).sort()).toEqual([
      "inbound-signal",
      "schedule",
      "webhook",
    ]);
    expect(delivered.map((item) => item.triggerEvent).sort()).toEqual([
      "authorization.fixture.scheduled",
      "inbound.signal.workflow-targeted",
      "webhook",
    ]);
    expect(workflowStartedScopes).toEqual([scopeId, scopeId, scopeId]);

    const routeApproval = seedApproval(approvalQueue, "safe-route-control", "moderate");
    const approvalResponse = mockResponse();
    await handleRejectApproval(
      mockRequest({ reason: "operator rejected via route" }),
      approvalResponse.res,
      routeApproval.id,
      null,
      approvalQueue,
      scopeId,
    );
    expect(approvalResponse.result.status).toBe(200);
    expect(approvalQueue.get(routeApproval.id)?.status).toBe("rejected");

    const routeQuestion = seedOwnerQuestion(ownerQuestionQueue);
    const ownerQuestionResponse = mockResponse();
    await handleAnswerOwnerQuestion(
      mockRequest({ answer: "yes, via authenticated route" }),
      ownerQuestionResponse.res,
      routeQuestion.id,
      ownerQuestionQueue,
      scopeId,
    );
    expect(ownerQuestionResponse.result.status).toBe(200);
    expect(ownerQuestionQueue.get(routeQuestion.id)).toMatchObject({
      status: "answered",
      answer: "yes, via authenticated route",
      resolutionSource: "http",
    });
  });
});
