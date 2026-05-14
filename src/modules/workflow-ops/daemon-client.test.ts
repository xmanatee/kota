/**
 * Workflow namespace daemon-side handler test.
 *
 * The workflow namespace migrated out of the core stub into
 * `daemonClient(link)` on the workflow-ops module. This test pins the
 * invariants the migration relies on:
 *
 *  1. The workflow-ops module exposes a `daemonClient(link)` factory and the
 *     factory contributes the `workflow` namespace with the thirteen contract
 *     methods.
 *  2. Each method routes through the expected HTTP method + path with the
 *     expected query/body shape (byte-for-byte against the prior core stub).
 *  3. The success arm decodes correctly for each method.
 *  4. The throw-on-`null` arm fires with the byte-for-byte error string for
 *     each of the eleven methods that throw on transport failure.
 *  5. `listRuns` and `getRun` soft-fall through on `null` (returning `{ runs:
 *     [] }` and `{ found: false }` respectively).
 *  6. `triggerByName` forwards only the user-extension `payload` after
 *     `buildTriggerHttpPayload` and includes `tags` only when non-empty.
 *  7. Supplying the contribution to the assembly path satisfies coverage.
 *  8. Removing the workflow-ops contribution makes assembly fail loudly with
 *     a clear "workflow" missing-handler error.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type {
  DaemonRequestInit,
  DaemonTransport,
} from "#core/server/daemon-transport.js";
import workflowOpsModule from "./index.js";

type RecordedRequest =
  | {
      kind: "request";
      method: string;
      path: string;
      body: unknown;
      init: DaemonRequestInit | undefined;
    }
  | {
      kind: "fetchRaw";
      path: string;
      init: RequestInit | undefined;
    };

type RequestResponder<T> = (
  method: string,
  path: string,
  body: unknown,
) => T | null | Promise<T | null>;

type FetchResponder = (
  path: string,
  init: RequestInit | undefined,
) => Response | Promise<Response>;

function makeRecordingTransport(opts?: {
  respondRequest?: RequestResponder<unknown>;
  respondFetch?: FetchResponder;
}): { transport: DaemonTransport; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({ Authorization: "Bearer test-token" }),
    request: async <T>(
      method: string,
      path: string,
      body?: unknown,
      init?: DaemonRequestInit,
    ): Promise<T | null> => {
      calls.push({ kind: "request", method, path, body, init });
      if (!opts?.respondRequest) return null;
      const result = await opts.respondRequest(method, path, body);
      return result as T | null;
    },
    requestStrict: async () => {
      throw new Error("not used");
    },
    fetchRaw: async (path: string, init?: RequestInit) => {
      calls.push({ kind: "fetchRaw", path, init });
      if (!opts?.respondFetch) {
        return new Response(null, { status: 200 });
      }
      return opts.respondFetch(path, init);
    },
    events: async function* () {
      // empty
    },
  };
  return { transport, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("workflow-ops module daemonClient(link) — workflow namespace", () => {
  it("contributes a workflow namespace handler", () => {
    expect(workflowOpsModule.daemonClient).toBeTypeOf("function");
    const { transport } = makeRecordingTransport();
    const contributed = workflowOpsModule.daemonClient!(transport);
    expect(contributed.workflow).toBeDefined();
    const wf = contributed.workflow!;
    expect(typeof wf.listRuns).toBe("function");
    expect(typeof wf.status).toBe("function");
    expect(typeof wf.pause).toBe("function");
    expect(typeof wf.resume).toBe("function");
    expect(typeof wf.abort).toBe("function");
    expect(typeof wf.reload).toBe("function");
    expect(typeof wf.enable).toBe("function");
    expect(typeof wf.disable).toBe("function");
    expect(typeof wf.cancelRun).toBe("function");
    expect(typeof wf.abortRun).toBe("function");
    expect(typeof wf.getRun).toBe("function");
    expect(typeof wf.listDefinitions).toBe("function");
    expect(typeof wf.triggerByName).toBe("function");
  });

  it("listRuns routes through GET /workflow/runs with no filter", async () => {
    const { transport, calls } = makeRecordingTransport({
      respondRequest: () => ({ runs: [] }),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    const result = await wf.listRuns();
    expect(result).toEqual({ runs: [] });
    expect(calls).toEqual([
      {
        kind: "request",
        method: "GET",
        path: "/workflow/runs",
        body: undefined,
        init: undefined,
      },
    ]);
  });

  it("listRuns serializes filter into the query string", async () => {
    const { transport, calls } = makeRecordingTransport({
      respondRequest: () => ({ runs: [] }),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await wf.listRuns({
      workflow: "builder",
      limit: 25,
      tag: "smoke",
      causedByRunId: "parent-run",
    });
    expect((calls[0] as { path: string }).path).toBe(
      "/workflow/runs?workflow=builder&limit=25&tag=smoke&causedByRunId=parent-run",
    );
  });

  it("listRuns soft-falls through on transport failure", async () => {
    const { transport } = makeRecordingTransport({
      respondRequest: () => null,
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    const result = await wf.listRuns();
    expect(result).toEqual({ runs: [] });
  });

  it("status routes through GET /workflow/status and adds pendingAbort: false", async () => {
    const live = {
      activeRuns: [],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 0,
      workflows: {},
      paused: false,
      agentConcurrency: 1,
      codeConcurrency: 4,
    };
    const { transport, calls } = makeRecordingTransport({
      respondFetch: () => jsonResponse(200, live),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    const result = await wf.status();
    expect(result).toEqual({ ...live, pendingAbort: false });
    expect(calls[0]).toEqual({
      kind: "fetchRaw",
      path: "/workflow/status",
      init: { method: "GET" },
    });
  });

  it("status serializes projectId into the query string", async () => {
    const live = {
      activeRuns: [],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 0,
      workflows: {},
      paused: false,
      agentConcurrency: 1,
      codeConcurrency: 4,
    };
    const { transport, calls } = makeRecordingTransport({
      respondFetch: () => jsonResponse(200, live),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await wf.status({ projectId: "project-b" });
    expect(calls[0]).toEqual({
      kind: "fetchRaw",
      path: "/workflow/status?projectId=project-b",
      init: { method: "GET" },
    });
  });

  it("status throws byte-for-byte on transport failure", async () => {
    const { transport } = makeRecordingTransport({
      respondFetch: () => {
        throw new Error("daemon down");
      },
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await expect(wf.status()).rejects.toThrow(
      "Daemon unreachable while reading workflow status",
    );
  });

  it("status preserves typed unknown-project route errors", async () => {
    const { transport } = makeRecordingTransport({
      respondFetch: () =>
        jsonResponse(404, {
          error: "Unknown project",
          reason: "unknown_project",
          projectId: "ghost",
        }),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await expect(wf.status({ projectId: "ghost" })).rejects.toThrow(
      "Unknown project: ghost",
    );
  });

  it("pause routes through POST /workflow/pause and decodes already?: false default", async () => {
    const { transport, calls } = makeRecordingTransport({
      respondRequest: () => ({ paused: true }),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    const result = await wf.pause();
    expect(result).toEqual({ paused: true, already: false });
    expect((calls[0] as { method: string; path: string }).method).toBe("POST");
    expect((calls[0] as { method: string; path: string }).path).toBe(
      "/workflow/pause",
    );
  });

  it("pause throws byte-for-byte on transport failure", async () => {
    const { transport } = makeRecordingTransport({
      respondRequest: () => null,
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await expect(wf.pause()).rejects.toThrow(
      "Daemon unreachable while pausing dispatch",
    );
  });

  it("resume routes through POST /workflow/resume and decodes already=true verbatim", async () => {
    const { transport, calls } = makeRecordingTransport({
      respondRequest: () => ({ paused: false, already: true }),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    const result = await wf.resume();
    expect(result).toEqual({ paused: false, already: true });
    expect((calls[0] as { path: string }).path).toBe("/workflow/resume");
  });

  it("resume throws byte-for-byte on transport failure", async () => {
    const { transport } = makeRecordingTransport({
      respondRequest: () => null,
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await expect(wf.resume()).rejects.toThrow(
      "Daemon unreachable while resuming dispatch",
    );
  });

  it("abort routes through POST /workflow/abort and reshapes aborted into count", async () => {
    const { transport, calls } = makeRecordingTransport({
      respondRequest: () => ({ aborted: 3 }),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    const result = await wf.abort();
    expect(result).toEqual({ status: "applied", count: 3 });
    expect((calls[0] as { path: string }).path).toBe("/workflow/abort");
  });

  it("abort throws byte-for-byte on transport failure", async () => {
    const { transport } = makeRecordingTransport({
      respondRequest: () => null,
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await expect(wf.abort()).rejects.toThrow(
      "Daemon unreachable while aborting active runs",
    );
  });

  it("reload routes through POST /workflow/reload and reshapes count", async () => {
    const { transport, calls } = makeRecordingTransport({
      respondRequest: () => ({ count: 7 }),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    const result = await wf.reload();
    expect(result).toEqual({ status: "applied", count: 7 });
    expect((calls[0] as { path: string }).path).toBe("/workflow/reload");
  });

  it("reload throws byte-for-byte on transport failure", async () => {
    const { transport } = makeRecordingTransport({
      respondRequest: () => null,
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await expect(wf.reload()).rejects.toThrow(
      "Daemon unreachable while reloading definitions",
    );
  });

  it("enable routes through POST /workflow/definitions/<name>/enable", async () => {
    const { transport, calls } = makeRecordingTransport({
      respondFetch: () => jsonResponse(200, { ok: true }),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    const result = await wf.enable("builder");
    expect(result).toEqual({ ok: true });
    const call = calls[0] as { kind: "fetchRaw"; path: string; init: RequestInit };
    expect(call.kind).toBe("fetchRaw");
    expect(call.path).toBe("/workflow/definitions/builder/enable");
    expect(call.init.method).toBe("POST");
  });

  it("enable url-escapes the name", async () => {
    const { transport, calls } = makeRecordingTransport({
      respondFetch: () => jsonResponse(200, { ok: true }),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await wf.enable("a/b c");
    expect((calls[0] as { path: string }).path).toBe(
      `/workflow/definitions/${encodeURIComponent("a/b c")}/enable`,
    );
  });

  it("enable decodes 404 to not_found", async () => {
    const { transport } = makeRecordingTransport({
      respondFetch: () => jsonResponse(404, {}),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    const result = await wf.enable("missing");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("enable throws byte-for-byte on transport failure", async () => {
    const { transport } = makeRecordingTransport({
      respondFetch: () => {
        throw new TypeError("fetch failed");
      },
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await expect(wf.enable("x")).rejects.toThrow(
      'Daemon unreachable while enabling workflow "x"',
    );
  });

  it("disable routes through POST /workflow/definitions/<name>/disable and decodes 404", async () => {
    const { transport, calls } = makeRecordingTransport({
      respondFetch: (_path) => jsonResponse(404, {}),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    const result = await wf.disable("builder");
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect((calls[0] as { path: string }).path).toBe(
      "/workflow/definitions/builder/disable",
    );
  });

  it("disable throws byte-for-byte on transport failure", async () => {
    const { transport } = makeRecordingTransport({
      respondFetch: () => {
        throw new TypeError("fetch failed");
      },
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await expect(wf.disable("y")).rejects.toThrow(
      'Daemon unreachable while disabling workflow "y"',
    );
  });

  it("cancelRun routes through DELETE /workflow/runs/<id>", async () => {
    const { transport, calls } = makeRecordingTransport({
      respondFetch: () => jsonResponse(200, { ok: true }),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    const result = await wf.cancelRun("run-1");
    expect(result).toEqual({ ok: true });
    const call = calls[0] as { path: string; init: RequestInit };
    expect(call.path).toBe("/workflow/runs/run-1");
    expect(call.init.method).toBe("DELETE");
  });

  it("cancelRun decodes 404 → not_found and 409 → active", async () => {
    {
      const { transport } = makeRecordingTransport({
        respondFetch: () => jsonResponse(404, {}),
      });
      const wf = workflowOpsModule.daemonClient!(transport).workflow!;
      expect(await wf.cancelRun("missing")).toEqual({
        ok: false,
        reason: "not_found",
      });
    }
    {
      const { transport } = makeRecordingTransport({
        respondFetch: () => jsonResponse(409, {}),
      });
      const wf = workflowOpsModule.daemonClient!(transport).workflow!;
      expect(await wf.cancelRun("active-id")).toEqual({
        ok: false,
        reason: "active",
      });
    }
  });

  it("cancelRun throws byte-for-byte on transport failure", async () => {
    const { transport } = makeRecordingTransport({
      respondFetch: () => {
        throw new TypeError("fetch failed");
      },
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await expect(wf.cancelRun("rid")).rejects.toThrow(
      'Daemon unreachable while cancelling run "rid"',
    );
  });

  it("abortRun routes through POST /workflow/runs/<id>/abort", async () => {
    const { transport, calls } = makeRecordingTransport({
      respondFetch: () => jsonResponse(200, { ok: true }),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    const result = await wf.abortRun("run-2");
    expect(result).toEqual({ ok: true });
    const call = calls[0] as { path: string; init: RequestInit };
    expect(call.path).toBe("/workflow/runs/run-2/abort");
    expect(call.init.method).toBe("POST");
  });

  it("abortRun decodes 404 → not_found and 409 → queued", async () => {
    {
      const { transport } = makeRecordingTransport({
        respondFetch: () => jsonResponse(404, {}),
      });
      const wf = workflowOpsModule.daemonClient!(transport).workflow!;
      expect(await wf.abortRun("missing")).toEqual({
        ok: false,
        reason: "not_found",
      });
    }
    {
      const { transport } = makeRecordingTransport({
        respondFetch: () => jsonResponse(409, {}),
      });
      const wf = workflowOpsModule.daemonClient!(transport).workflow!;
      expect(await wf.abortRun("queued-id")).toEqual({
        ok: false,
        reason: "queued",
      });
    }
  });

  it("abortRun throws byte-for-byte on transport failure", async () => {
    const { transport } = makeRecordingTransport({
      respondFetch: () => {
        throw new TypeError("fetch failed");
      },
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await expect(wf.abortRun("zid")).rejects.toThrow(
      'Daemon unreachable while aborting run "zid"',
    );
  });

  it("getRun routes through GET /workflow/runs/<id> and soft-falls through on null", async () => {
    {
      const detail = {
        id: "run-1",
        workflow: "builder",
        status: "succeeded",
        triggerEvent: "manual",
        startedAt: "2026-05-05T00:00:00Z",
        steps: [],
      };
      const { transport, calls } = makeRecordingTransport({
        respondRequest: () => detail,
      });
      const wf = workflowOpsModule.daemonClient!(transport).workflow!;
      const result = await wf.getRun("run-1");
      expect(result).toEqual({ found: true, run: detail });
      expect((calls[0] as { method: string; path: string }).method).toBe("GET");
      expect((calls[0] as { method: string; path: string }).path).toBe(
        "/workflow/runs/run-1",
      );
    }
    {
      const { transport } = makeRecordingTransport({
        respondRequest: () => null,
      });
      const wf = workflowOpsModule.daemonClient!(transport).workflow!;
      expect(await wf.getRun("missing")).toEqual({ found: false });
    }
  });

  it("listDefinitions routes through GET /workflow/definitions and reshapes source: 'daemon'", async () => {
    const { transport, calls } = makeRecordingTransport({
      respondRequest: () => ({ definitions: [] }),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    const result = await wf.listDefinitions();
    expect(result).toEqual({ source: "daemon", definitions: [] });
    expect((calls[0] as { method: string; path: string }).path).toBe(
      "/workflow/definitions",
    );
  });

  it("listDefinitions throws byte-for-byte on transport failure", async () => {
    const { transport } = makeRecordingTransport({
      respondRequest: () => null,
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await expect(wf.listDefinitions()).rejects.toThrow(
      "Daemon unreachable while listing workflow definitions",
    );
  });

  it("triggerByName routes through POST /workflow/trigger and forwards only the user-extension payload", async () => {
    const { transport, calls } = makeRecordingTransport({
      respondFetch: () => jsonResponse(200, { queued: "wf-1", runId: "r-1" }),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    const result = await wf.triggerByName("wf-1", {
      tags: ["smoke"],
      payload: { extra: "info" },
      // event/runId/force/notBeforeMs are ignored on the wire path
      event: "manual-override",
      runId: "client-pinned",
      force: true,
      notBeforeMs: 0,
    });
    expect(result).toEqual({
      ok: true,
      path: "daemon",
      queued: "wf-1",
      runId: "r-1",
    });
    const call = calls[0] as { path: string; init: RequestInit };
    expect(call.path).toBe("/workflow/trigger");
    expect(call.init.method).toBe("POST");
    const body = JSON.parse(String(call.init.body));
    expect(body).toEqual({
      name: "wf-1",
      tags: ["smoke"],
      payload: { extra: "info" },
    });
  });

  it("triggerByName omits empty tags and missing payload", async () => {
    const { transport, calls } = makeRecordingTransport({
      respondFetch: () => jsonResponse(200, {}),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await wf.triggerByName("wf-2");
    const call = calls[0] as { init: RequestInit };
    expect(JSON.parse(String(call.init.body))).toEqual({ name: "wf-2" });
  });

  it("triggerByName omits payload when payload is an empty object", async () => {
    const { transport, calls } = makeRecordingTransport({
      respondFetch: () => jsonResponse(200, { queued: "wf-3" }),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await wf.triggerByName("wf-3", { payload: {} });
    const call = calls[0] as { init: RequestInit };
    expect(JSON.parse(String(call.init.body))).toEqual({ name: "wf-3" });
  });

  it("triggerByName decodes 409 → already_queued", async () => {
    const { transport } = makeRecordingTransport({
      respondFetch: () => jsonResponse(409, {}),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    expect(await wf.triggerByName("wf-1")).toEqual({
      ok: false,
      reason: "already_queued",
    });
  });

  it("triggerByName falls back queued to the workflow name when the daemon body omits it", async () => {
    const { transport } = makeRecordingTransport({
      respondFetch: () => jsonResponse(200, {}),
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    expect(await wf.triggerByName("wf-1")).toEqual({
      ok: true,
      path: "daemon",
      queued: "wf-1",
    });
  });

  it("triggerByName throws byte-for-byte on transport failure", async () => {
    const { transport } = makeRecordingTransport({
      respondFetch: () => {
        throw new TypeError("fetch failed");
      },
    });
    const wf = workflowOpsModule.daemonClient!(transport).workflow!;
    await expect(wf.triggerByName("wf-1")).rejects.toThrow(
      'Daemon unreachable while triggering workflow "wf-1"',
    );
  });

  it("supplying the workflow contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport();
    const contributed = workflowOpsModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.workflow;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });

  it("the assembly path fails loudly when the workflow contribution is removed", () => {
    const { transport } = makeRecordingTransport();
    const others = buildMigratedNamespaceTestStubs();
    delete others.workflow;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /workflow/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });
});
