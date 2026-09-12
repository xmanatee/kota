import { describe, expect, it } from "vitest";
import type { ApprovalsListResult } from "./client.js";
import {
  ENCODING_SENSITIVE_ID,
  makeApproval,
  makeRecordingTransport,
} from "./daemon-client-test-support.integration.js";
import approvalQueueModule from "./index.js";

describe("approval-queue module daemonClient(link)", () => {
  it("routes list() with no filter through GET /approvals (no query string) with no body", async () => {
    const expected: ApprovalsListResult = { approvals: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = approvalQueueModule.daemonClient!(transport);
    const result = await contributed.approvals!.list();
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/approvals",
        body: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("routes approve(id, note?) through POST /approvals/:id/approve with encodeURIComponent and { note } body", async () => {
    const approval = makeApproval(ENCODING_SENSITIVE_ID, "approved");
    const resolution = {
      kind: "tool_execution" as const,
      execution: {
        status: "succeeded" as const,
        output: { redacted: true as const, reason: "tool-io" as const },
      },
    };
    const { transport, calls } = makeRecordingTransport(() => ({ approval, resolution }));
    const contributed = approvalQueueModule.daemonClient!(transport);
    const result = await contributed.approvals!.approve(
      ENCODING_SENSITIVE_ID,
      "a".repeat(64),
      "looks good",
    );
    expect(result).toEqual({ ok: true, approval, resolution });
    expect(calls).toEqual([
      {
        path: `/approvals/${encodeURIComponent(ENCODING_SENSITIVE_ID)}/approve`,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reviewDigest: "a".repeat(64),
            note: "looks good",
          }),
        },
        shape: "fetchRaw",
      },
    ]);
  });

  it("preserves an explicit workflow-gate approval resolution", async () => {
    const approval = {
      ...makeApproval("a-gate", "approved"),
      kind: "workflow_gate" as const,
    };
    const resolution = { kind: "workflow_gate_approved" as const };
    const { transport } = makeRecordingTransport(() => ({ approval, resolution }));
    const contributed = approvalQueueModule.daemonClient!(transport);

    await expect(contributed.approvals!.approve("a-gate", "a".repeat(64)))
      .resolves.toEqual({ ok: true, approval, resolution });
  });

  it("rejects an ambiguous successful approval response", async () => {
    const approval = makeApproval("a-ambiguous", "approved");
    const { transport } = makeRecordingTransport(() => ({ approval }));
    const contributed = approvalQueueModule.daemonClient!(transport);

    await expect(contributed.approvals!.approve("a-ambiguous", "a".repeat(64)))
      .rejects.toThrow(/invalid approval resolution/);
  });
});
