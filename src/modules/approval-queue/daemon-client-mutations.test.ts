import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import {
  ENCODING_SENSITIVE_ID,
  makeApproval,
  makeRecordingTransport,
} from "./daemon-client-test-support.integration.js";
import approvalQueueModule from "./index.js";

describe("approval-queue daemon client mutations", () => {
  it("routes reject with an encoded id and reason body", async () => {
    const approval = makeApproval(ENCODING_SENSITIVE_ID, "rejected");
    const { transport, calls } = makeRecordingTransport(() => ({ approval }));
    const client = approvalQueueModule.daemonClient!(transport).approvals!;

    await expect(client.reject(ENCODING_SENSITIVE_ID, "policy violation"))
      .resolves.toEqual({ ok: true, approval });
    expect(calls).toEqual([{
      path: `/approvals/${encodeURIComponent(ENCODING_SENSITIVE_ID)}/reject`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "policy violation" }),
      },
      shape: "fetchRaw",
    }]);
  });

  it("routes reject without a reason as an undefined reason body", async () => {
    const approval = makeApproval("a-bare", "rejected");
    const { transport, calls } = makeRecordingTransport(() => ({ approval }));
    const client = approvalQueueModule.daemonClient!(transport).approvals!;

    await expect(client.reject("a-bare")).resolves.toEqual({ ok: true, approval });
    expect(calls[0]).toMatchObject({
      path: "/approvals/a-bare/reject",
      init: { body: JSON.stringify({ reason: undefined }) },
      shape: "fetchRaw",
    });
  });

  it("threads projectId through list and mutations", async () => {
    const approval = makeApproval("a-project", "approved");
    const { transport, calls } = makeRecordingTransport((_method, path, _body, shape) =>
      shape === "requestStrict"
        ? { approvals: [] }
        : path.includes("/approve")
          ? {
              approval,
              resolution: {
                kind: "tool_execution",
                execution: {
                  status: "succeeded",
                  output: { redacted: true, reason: "tool-io" },
                },
              },
            }
          : { approval },
    );
    const client = approvalQueueModule.daemonClient!(transport).approvals!;

    await client.list({ status: "pending", projectId: "project-b" });
    await client.approve(
      "a-project",
      "a".repeat(64),
      "ok",
      { projectId: "project-b" },
    );
    await client.reject("a-project", "no", { projectId: "project-b" });

    expect(calls.map((call) => call.path)).toEqual([
      "/approvals?status=pending&projectId=project-b",
      "/approvals/a-project/approve?projectId=project-b",
      "/approvals/a-project/reject?projectId=project-b",
    ]);
  });

  it.each([
    ["approve", "missing-id"],
    ["reject", "missing-id"],
  ] as const)("collapses a null response from %s into not_found", async (method, id) => {
    const client = approvalQueueModule.daemonClient!(makeRecordingTransport(() => null).transport).approvals!;
    const result = method === "approve"
      ? client.approve(id, "a".repeat(64))
      : client.reject(id);
    await expect(result).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it.each(["approve", "reject"] as const)(
    "collapses an invalid-id response from %s",
    async (method) => {
      const response = new Response(JSON.stringify({
        error: "Invalid approval id",
        reason: "invalid_approval_id",
        id: "../abcd1234",
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      const client = approvalQueueModule.daemonClient!(
        makeRecordingTransport(() => response).transport,
      ).approvals!;
      const result = method === "approve"
        ? client.approve("../abcd1234", "a".repeat(64))
        : client.reject("../abcd1234");
      await expect(result)
        .resolves.toEqual({ ok: false, reason: "invalid_id" });
    },
  );

  it("collapses unavailable input and scope mismatch responses", async () => {
    const responses = [
      ["approval_input_unavailable", "input_unavailable"],
      ["approval_scope_mismatch", "scope_mismatch"],
      ["approval_review_digest_mismatch", "review_mismatch"],
    ] as const;
    for (const [wireReason, expectedReason] of responses) {
      const response = new Response(JSON.stringify({ reason: wireReason }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
      const client = approvalQueueModule.daemonClient!(
        makeRecordingTransport(() => response).transport,
      ).approvals!;
      await expect(client.approve("deadbeef", "a".repeat(64)))
        .resolves.toEqual({ ok: false, reason: expectedReason });
    }
  });

  it("throws typed unknown-project errors", async () => {
    const response = new Response(JSON.stringify({
      error: "Unknown project",
      reason: "unknown_project",
      projectId: "missing-project",
    }), { status: 404, headers: { "Content-Type": "application/json" } });
    const client = approvalQueueModule.daemonClient!(
      makeRecordingTransport(() => response).transport,
    ).approvals!;
    await expect(client.approve(
      "a-1",
      "a".repeat(64),
      undefined,
      { projectId: "missing-project" },
    ))
      .rejects.toThrow(/Unknown project: missing-project/);
  });

  it("requires and accepts the approvals namespace in assembled clients", () => {
    const { transport } = makeRecordingTransport(() => null);
    const others = buildMigratedNamespaceTestStubs();
    delete others.approvals;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(/missing daemon handler/);

    const contributed = approvalQueueModule.daemonClient!(transport);
    expect(() => assembleDaemonClientHandlers(transport, { ...others, ...contributed }))
      .not.toThrow();
  });
});
