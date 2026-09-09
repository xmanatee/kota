import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { vi } from "vitest";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";

export function mockRequest(body: Record<string, unknown> = {}, url?: string): IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    headers: { "content-type": "application/json" },
    url,
  }) as IncomingMessage;
}

export function mockResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead: (s: number) => {
      result.status = s;
    },
    end: (data: string) => {
      result.body = JSON.parse(data);
    },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

export function reviewDigest(queue: ApprovalQueue, id: string): string {
  const item = queue.get(id);
  if (!item) throw new Error(`Missing approval ${id}`);
  const review = queue.projectForClient(item).review;
  if (review.status !== "available") throw new Error(`Approval ${id} is not reviewable`);
  return review.digest;
}

export function approvalDecisionBody(
  queue: ApprovalQueue,
  id: string,
  note?: string,
): Record<string, unknown> {
  return {
    reviewDigest: reviewDigest(queue, id),
    ...(note !== undefined ? { note } : {}),
  };
}

export function approvalBatchDecisionBody(queue: ApprovalQueue): Record<string, unknown> {
  return {
    reviews: queue.list("pending").map((item) => ({
      id: item.id,
      digest: reviewDigest(queue, item.id),
    })),
  };
}

export function approvePending(queue: ApprovalQueue, id: string): void {
  const selection = queue.getExecutionSnapshot(id);
  if (!selection.ok) throw new Error("expected execution snapshot");
  const result = queue.approveForExecution(selection.snapshot.descriptor);
  if (!result.ok) throw new Error("expected execution approval");
}
