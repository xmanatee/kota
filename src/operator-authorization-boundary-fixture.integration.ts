import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { expect } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { formatRunId } from "#core/workflow/run-io.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { inboundSignalRouted } from "#modules/inbound-signals/events.js";
import { dispatchInboundSignalRoute } from "#modules/inbound-signals/routing.js";

export const APPROVAL_WORDS = "approve yes allow";
const INBOUND_WORKFLOW = "inbound-operator-boundary";

export type DeliverySource = "schedule" | "webhook" | "inbound-signal";
export type DeliveredWorkflow = {
  source: DeliverySource;
  triggerEvent: string;
  payloadText: string;
};

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(10);
  }
  if (predicate()) return;
  throw new Error(message);
}

export function mockResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: () => undefined,
    writeHead: (status: number) => {
      result.status = status;
    },
    end: (data: string) => {
      result.body = JSON.parse(data) as unknown;
    },
    on: () => undefined,
  } as unknown as ServerResponse;
  return { res, result };
}

export function mockRequest(body: Record<string, unknown> = {}): IncomingMessage {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage;
  req.headers = { "content-type": "application/json" };
  return req;
}

export function makePromptQueues(projectDir: string, pbus: ProjectScopedEventBus) {
  return {
    approvalQueue: new ApprovalQueue(join(projectDir, ".kota", "approvals"), pbus),
    ownerQuestionQueue: new OwnerQuestionQueue(
      join(projectDir, ".kota", "owner-questions"),
      pbus,
    ),
  };
}

export function seedApproval(
  queue: ApprovalQueue,
  command = "deploy-production",
  risk: "dangerous" | "moderate" = "dangerous",
) {
  return queue.enqueue(
    "shell",
    { command },
    risk,
    "Operator authorization boundary test.",
    "authorization-boundary-test",
  );
}

export function seedOwnerQuestion(queue: OwnerQuestionQueue) {
  return queue.enqueue({
    context: "Boundary regression for operator authorization.",
    question: "Should this pending operator prompt be resolved?",
    reason: "Only authenticated operator routes or allowed channel callbacks may resolve it.",
    source: "test",
    answerBehavior: "record-only",
    origin: { kind: "manual", source: "authorization-boundary-test" },
    proposedAnswers: ["yes", "no"],
  });
}

export function approvalLikeText(approvalId: string, questionId: string): string {
  return `${APPROVAL_WORDS} ${approvalId} ${questionId} yes`;
}

export function expectPromptsPending(
  approvalQueue: ApprovalQueue,
  ownerQuestionQueue: OwnerQuestionQueue,
  approvalId: string,
  questionId: string,
): void {
  expect(approvalQueue.get(approvalId)?.status).toBe("pending");
  expect(ownerQuestionQueue.get(questionId)?.status).toBe("pending");
}

function enqueueExternalWorkflowDelivery(
  projectDir: string,
  workflowName: string,
  options: { event?: string; payload?: Record<string, unknown> },
): { runId: string } {
  const store = new WorkflowRunStore(projectDir);
  const state = store.readState();
  const now = Date.now();
  const runId = formatRunId(workflowName);
  const trigger: WorkflowRunTrigger = {
    event: options.event ?? "manual",
    schemaRef: null,
    payload: {
      ...(options.payload ?? {}),
      triggeredAt: new Date().toISOString(),
      _runId: runId,
    },
  };
  store.setPendingRuns([
    ...state.pendingRuns,
    { runId, workflowName, trigger, enqueuedAtMs: now, notBeforeMs: now },
  ]);
  return { runId };
}

function recordStep(source: DeliverySource, delivered: DeliveredWorkflow[]) {
  return {
    id: "record",
    type: "code" as const,
    run: (ctx: WorkflowStepContext): DeliveredWorkflow => {
      const delivery = {
        source,
        triggerEvent: ctx.trigger.event,
        payloadText: JSON.stringify(ctx.trigger.payload),
      };
      delivered.push(delivery);
      return delivery;
    },
  };
}

function boundaryWorkflow(
  name: string,
  triggers: Parameters<typeof registerWorkflowDefinition>[1]["triggers"],
  source: DeliverySource,
  delivered: DeliveredWorkflow[],
) {
  return registerWorkflowDefinition(`test/${name}.ts`, {
    name,
    triggers,
    steps: [recordStep(source, delivered)],
  });
}

export function inboundWorkflow(delivered: DeliveredWorkflow[]) {
  return boundaryWorkflow(
    INBOUND_WORKFLOW,
    [{ event: inboundSignalRouted.name, cooldownMs: 0 }],
    "inbound-signal",
    delivered,
  );
}

export function allWorkflows(delivered: DeliveredWorkflow[], text: string) {
  return [
    boundaryWorkflow(
      "scheduled-operator-boundary",
      [
        {
          event: "authorization.fixture.scheduled",
          intervalMs: 3_600_000,
          payload: { source: "schedule", text },
        },
      ],
      "schedule",
      delivered,
    ),
    boundaryWorkflow(
      "webhook-operator-boundary",
      [{ webhook: true }],
      "webhook",
      delivered,
    ),
    inboundWorkflow(delivered),
  ];
}

export async function dispatchInboundDelivery(args: {
  projectDir: string;
  pbus: ProjectScopedEventBus;
  scopeId: string;
  text: string;
  routedPayloads: unknown[];
}): Promise<void> {
  await dispatchInboundSignalRoute({
    config: {
      routes: [
        {
          id: "operator-boundary-inbound",
          provider: "slack",
          channel: "slack.message",
          actorTrust: "trusted",
          scopeId: args.scopeId,
          targets: [{ kind: "workflow", name: INBOUND_WORKFLOW }],
        },
      ],
    },
    signal: {
      scopeId: args.scopeId,
      projectId: args.scopeId,
      provider: "slack",
      channel: "slack.message",
      accountId: "workspace-1",
      sourceId: "channel-1",
      sourceUrl: "https://example.test/slack/channel-1",
      externalId: "message-1",
      occurredAt: "2026-06-21T08:00:00.000Z",
      receivedAt: "2026-06-21T08:00:01.000Z",
      actor: {
        id: "user-1",
        displayName: "Inbound User",
        trust: "trusted",
        trustReason: "adapter-authenticated sender, not operator prompt authority",
      },
      body: { kind: "message", format: "plain", text: args.text },
    },
    context: { workflowNames: new Set([INBOUND_WORKFLOW]), agentNames: new Set() },
    deps: {
      async triggerWorkflow(name, options) {
        const { runId } = enqueueExternalWorkflowDelivery(args.projectDir, name, {
          event: options.event,
          payload: options.payload,
        });
        return { ok: true, path: "queue", queued: name, runId };
      },
      emitRouted(payload) {
        args.routedPayloads.push(payload);
        args.pbus.emit(inboundSignalRouted, payload);
      },
    },
  });
}
