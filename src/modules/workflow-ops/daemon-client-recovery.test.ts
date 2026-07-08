import { describe, expect, it } from "vitest";
import type {
  DaemonRequestInit,
  DaemonTransport,
} from "#core/server/daemon-transport.js";
import workflowOpsModule from "./index.js";

function makeTransport(response: unknown): DaemonTransport {
  return {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({ Authorization: "Bearer test-token" }),
    request: async <T>(
      _method: string,
      _path: string,
      _body?: unknown,
      _init?: DaemonRequestInit,
    ): Promise<T | null> => response as T,
    requestStrict: async () => {
      throw new Error("not used");
    },
    fetchRaw: async () => new Response(null, { status: 200 }),
    events: async function* () {
      // empty
    },
  };
}

type RecordedFetch = {
  path: string;
  init: RequestInit | undefined;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetchRecordingTransport(response: Response): {
  transport: DaemonTransport;
  calls: RecordedFetch[];
} {
  const calls: RecordedFetch[] = [];
  return {
    calls,
    transport: {
      baseUrl: "http://127.0.0.1:0",
      authHeaders: () => ({ Authorization: "Bearer test-token" }),
      request: async () => {
        throw new Error("not used");
      },
      requestStrict: async () => {
        throw new Error("not used");
      },
      fetchRaw: async (path, init) => {
        calls.push({ path, init });
        return response;
      },
      events: async function* () {
        // empty
      },
    },
  };
}

describe("workflow-ops daemonClient recovery responses", () => {
  it("resume preserves dirty-recovery blocked responses from the daemon", async () => {
    const wf = workflowOpsModule.daemonClient!(
      makeTransport({
        paused: true,
        already: true,
        blocked: "dirty-recovery",
        message: "Clean or stash the dirty checkout, then run `kota workflow resume`.",
      }),
    ).workflow!;

    await expect(wf.resume()).resolves.toEqual({
      paused: true,
      already: true,
      blocked: "dirty-recovery",
      message: "Clean or stash the dirty checkout, then run `kota workflow resume`.",
    });
  });

  it("exposes and routes workflow state recovery list requests", async () => {
    const { transport, calls } = makeFetchRecordingTransport(
      jsonResponse(200, { ok: true, claims: [] }),
    );
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;

    expect(typeof wf.listStateRecoveryActions).toBe("function");
    const result = await wf.listStateRecoveryActions({ projectId: "project-a" });

    expect(result).toEqual({ ok: true, claims: [] });
    expect(calls[0]).toEqual({
      path: "/workflow/state-recovery?projectId=project-a",
      init: { method: "GET" },
    });
  });

  it("routes workflow state recovery resolve requests", async () => {
    const response = {
      ok: true,
      action: "release",
      message: "released",
      artifactPath: "/tmp/workflow-state-recovery.json",
      artifact: {
        schemaVersion: 1,
        createdAt: "2026-06-27T00:00:00.000Z",
        projectDir: "/project",
        actor: "operator",
        taskId: "task-a",
        requestedRunId: "run-a",
        action: "release",
        rationale: "safe to release",
        before: null,
        after: null,
        relatedDeadLetters: [],
        result: "released",
        message: "released",
      },
    };
    const { transport, calls } = makeFetchRecordingTransport(jsonResponse(200, response));
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;

    expect(typeof wf.resolveStateRecovery).toBe("function");
    const result = await wf.resolveStateRecovery({
      projectId: "project-a",
      taskId: "task-a",
      action: "release",
      rationale: "safe to release",
      runId: "run-a",
      actor: "operator",
      artifactRunId: "run-recovery",
    });

    expect(result).toEqual(response);
    expect(calls[0]?.path).toBe(
      "/workflow/state-recovery/claims/task-a/resolve?projectId=project-a",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      action: "release",
      rationale: "safe to release",
      runId: "run-a",
      actor: "operator",
      artifactRunId: "run-recovery",
    });
  });
});
