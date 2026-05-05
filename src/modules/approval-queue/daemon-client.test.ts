/**
 * Approval-queue namespace daemon-side handler test.
 *
 * The approvals namespace migrated out of the core stub into
 * `daemonClient(link)` on the approval-queue module. This test pins the
 * invariants the migration relies on:
 *
 *  1. The approval-queue module exposes a `daemonClient(link)` factory and
 *     the factory returns a handler for the `approvals` namespace.
 *  2. `list()` is wired through `DaemonTransport.requestStrict<T>` with
 *     method `GET`, path `/approvals`, and an undefined body when no
 *     filter is provided. The daemon route's `readStatusFilter` defaults
 *     to `pending` when no `?status=` query is present, matching the
 *     local handler.
 *  3. `list({ status })` for every `ApprovalStatus | "all"` value routes
 *     through `requestStrict<T>` with the matching `?status=...` query
 *     string, including a status containing reserved characters threaded
 *     through `encodeURIComponent`.
 *  4. `approve(id, note?)` is wired through `request<T>` with method
 *     `POST`, path `/approvals/${encodeURIComponent(id)}/approve`, and
 *     body `{ note }`. An id containing reserved characters round-trips
 *     through the encoding unchanged.
 *  5. `reject(id, reason?)` is wired through `request<T>` with method
 *     `POST`, path `/approvals/${encodeURIComponent(id)}/reject`, and
 *     body `{ reason }`. The same encoding-sensitive id round-trips
 *     unchanged.
 *  6. Every `ApprovalsListResult` payload decodes through `requestStrict<T>`
 *     unchanged — empty approvals plus a multi-entry payload mixing
 *     pending / approved / rejected statuses.
 *  7. Both `ApprovalMutateResult` arms decode correctly: a `200`
 *     `{ approval }` response collapses into `{ ok: true, approval }` and
 *     a `null` (404) response collapses into
 *     `{ ok: false, reason: "not_found" }`, asserted for both `approve`
 *     and `reject`.
 *  8. Removing the approval-queue module's daemonClient contribution
 *     makes the assembled client fail loudly with a clear "approvals"
 *     missing-handler error.
 *  9. Supplying the contribution to the assembly path satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import type {
  ApprovalStatus,
  PendingApproval,
} from "#core/daemon/approval-queue.js";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { ApprovalsListResult } from "./client.js";
import approvalQueueModule from "./index.js";

type RecordedCall = {
  method: string;
  path: string;
  body: unknown;
  shape: "request" | "requestStrict";
};

const ENCODING_SENSITIVE_ID = "weird/id %name with space";

function makeRecordingTransport(
  responder: (
    method: string,
    path: string,
    body: unknown,
    shape: "request" | "requestStrict",
  ) => unknown,
): { transport: DaemonTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T | null> => {
      calls.push({ method, path, body, shape: "request" });
      return responder(method, path, body, "request") as T | null;
    },
    requestStrict: async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T> => {
      calls.push({ method, path, body, shape: "requestStrict" });
      return responder(method, path, body, "requestStrict") as T;
    },
    fetchRaw: async () => new Response(null, { status: 200 }),
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

function makeApproval(
  id: string,
  status: ApprovalStatus = "pending",
): PendingApproval {
  return {
    id,
    tool: "shell",
    input: { command: `echo ${id}` },
    risk: "moderate",
    reason: "test approval",
    createdAt: "2026-05-04T12:34:56.000Z",
    status,
  };
}

describe("approval-queue module daemonClient(link)", () => {
  it("contributes an approvals namespace handler", () => {
    expect(approvalQueueModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport(() => null).transport;
    const contributed = approvalQueueModule.daemonClient!(link);
    expect(contributed.approvals).toBeDefined();
    expect(typeof contributed.approvals!.list).toBe("function");
    expect(typeof contributed.approvals!.approve).toBe("function");
    expect(typeof contributed.approvals!.reject).toBe("function");
  });

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

  it("routes list({ status }) for every ApprovalStatus | 'all' value through GET /approvals?status=...", async () => {
    const cases: (ApprovalStatus | "all")[] = [
      "pending",
      "approved",
      "rejected",
      "expired",
      "all",
    ];
    for (const status of cases) {
      const expected: ApprovalsListResult = { approvals: [] };
      const { transport, calls } = makeRecordingTransport(() => expected);
      const contributed = approvalQueueModule.daemonClient!(transport);
      const result = await contributed.approvals!.list({ status });
      expect(result).toEqual(expected);
      expect(calls).toEqual([
        {
          method: "GET",
          path: `/approvals?status=${encodeURIComponent(status)}`,
          body: undefined,
          shape: "requestStrict",
        },
      ]);
    }
  });

  it("threads a status containing reserved characters through encodeURIComponent on the query string", async () => {
    const weird = "weird+status %value" as unknown as ApprovalStatus | "all";
    const expected: ApprovalsListResult = { approvals: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = approvalQueueModule.daemonClient!(transport);
    await contributed.approvals!.list({ status: weird });
    expect(calls).toEqual([
      {
        method: "GET",
        path: `/approvals?status=${encodeURIComponent(weird)}`,
        body: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("decodes a multi-entry ApprovalsListResult payload mixing pending / approved / rejected statuses", async () => {
    const expected: ApprovalsListResult = {
      approvals: [
        makeApproval("a-1", "pending"),
        makeApproval("a-2", "approved"),
        makeApproval("a-3", "rejected"),
      ],
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = approvalQueueModule.daemonClient!(transport);
    const result = await contributed.approvals!.list({ status: "all" });
    expect(result).toEqual(expected);
  });

  it("routes approve(id, note?) through POST /approvals/:id/approve with encodeURIComponent and { note } body", async () => {
    const approval = makeApproval(ENCODING_SENSITIVE_ID, "approved");
    const { transport, calls } = makeRecordingTransport(() => ({ approval }));
    const contributed = approvalQueueModule.daemonClient!(transport);
    const result = await contributed.approvals!.approve(
      ENCODING_SENSITIVE_ID,
      "looks good",
    );
    expect(result).toEqual({ ok: true, approval });
    expect(calls).toEqual([
      {
        method: "POST",
        path: `/approvals/${encodeURIComponent(ENCODING_SENSITIVE_ID)}/approve`,
        body: { note: "looks good" },
        shape: "request",
      },
    ]);
  });

  it("routes approve(id) without a note as { note: undefined } body", async () => {
    const approval = makeApproval("a-bare", "approved");
    const { transport, calls } = makeRecordingTransport(() => ({ approval }));
    const contributed = approvalQueueModule.daemonClient!(transport);
    const result = await contributed.approvals!.approve("a-bare");
    expect(result).toEqual({ ok: true, approval });
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/approvals/a-bare/approve",
        body: { note: undefined },
        shape: "request",
      },
    ]);
  });

  it("routes reject(id, reason?) through POST /approvals/:id/reject with encodeURIComponent and { reason } body", async () => {
    const approval = makeApproval(ENCODING_SENSITIVE_ID, "rejected");
    const { transport, calls } = makeRecordingTransport(() => ({ approval }));
    const contributed = approvalQueueModule.daemonClient!(transport);
    const result = await contributed.approvals!.reject(
      ENCODING_SENSITIVE_ID,
      "policy violation",
    );
    expect(result).toEqual({ ok: true, approval });
    expect(calls).toEqual([
      {
        method: "POST",
        path: `/approvals/${encodeURIComponent(ENCODING_SENSITIVE_ID)}/reject`,
        body: { reason: "policy violation" },
        shape: "request",
      },
    ]);
  });

  it("routes reject(id) without a reason as { reason: undefined } body", async () => {
    const approval = makeApproval("a-bare", "rejected");
    const { transport, calls } = makeRecordingTransport(() => ({ approval }));
    const contributed = approvalQueueModule.daemonClient!(transport);
    const result = await contributed.approvals!.reject("a-bare");
    expect(result).toEqual({ ok: true, approval });
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/approvals/a-bare/reject",
        body: { reason: undefined },
        shape: "request",
      },
    ]);
  });

  it("collapses a null (404) response from approve into { ok: false, reason: 'not_found' }", async () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = approvalQueueModule.daemonClient!(transport);
    const result = await contributed.approvals!.approve("missing-id");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("collapses a null (404) response from reject into { ok: false, reason: 'not_found' }", async () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = approvalQueueModule.daemonClient!(transport);
    const result = await contributed.approvals!.reject("missing-id");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("the assembly path fails loudly when the approval-queue module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport(() => null);
    const others = buildMigratedNamespaceTestStubs();
    delete others.approvals;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /approvals/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the approval-queue module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = approvalQueueModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.approvals;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
