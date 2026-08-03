import { describe, expect, it } from "vitest";
import {
  action,
  resultSpec,
} from "#core/daemon/ui-surface-builders.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import daemonModule, { buildOperatorControlUiSurface } from "./index.js";
import type { UiSurfaceBundle } from "./operator-ui.js";

type RecordedRequest = {
  kind: "request" | "strict";
  method: string;
  path: string;
  body: unknown;
};

function scopedActionBundle(): UiSurfaceBundle {
  const template = buildOperatorControlUiSurface("scope-b");
  const launch = template.actions.find((candidate) =>
    candidate.actionId === "workflow.launch"
  );
  if (!launch) throw new Error("workflow.launch fixture action missing");
  return {
    protocolVersion: "ui.surface.v1",
    surfaces: [{
      ...template,
      nodes: [],
      actions: [
        action({
          surfaceId: template.surfaceId,
          actionId: "workflow.status",
          scopeId: template.scopeId,
          label: "Refresh workflow status",
          operation: {
            kind: "client-namespace",
            namespace: "workflow",
            method: "status",
          },
          result: resultSpec("Workflow status loaded."),
        }),
        action({
          surfaceId: template.surfaceId,
          actionId: "workflow.retry",
          scopeId: template.scopeId,
          label: "Retry workflow run",
          operation: {
            kind: "client-namespace",
            namespace: "workflow",
            method: "retryRun",
          },
          result: resultSpec("Workflow retry queued."),
        }),
        action({
          surfaceId: template.surfaceId,
          actionId: "memory.list",
          scopeId: template.scopeId,
          label: "Reload memory",
          operation: {
            kind: "client-namespace",
            namespace: "memory",
            method: "list",
          },
          result: resultSpec("Memory loaded."),
        }),
        launch,
      ],
    }],
  };
}

function recordingTransport(bundle: UiSurfaceBundle): {
  transport: DaemonTransport;
  calls: RecordedRequest[];
} {
  const calls: RecordedRequest[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async <T>(method: string, path: string, body?: unknown) => {
      calls.push({ kind: "request", method, path, body });
      if (method === "GET" && path.startsWith("/workflow/runs/run-1?")) {
        return {
          id: "run-1",
          workflow: "builder",
          status: "failed",
          triggerEvent: "autonomy.builder.recovery.requested",
          triggerSchemaRef: null,
          triggerPayload: { source: "fixture" },
        } as T;
      }
      return {} as T;
    },
    requestStrict: async <T>(method: string, path: string, body?: unknown) => {
      calls.push({ kind: "strict", method, path, body });
      if (method === "POST" && path === "/ui/actions/execute") {
        return { ok: true, message: "Setup action started." } as T;
      }
      return bundle as T;
    },
    fetchRaw: async () => {
      throw new Error("not used");
    },
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

describe("daemon UI action scope", () => {
  it("delegates setup actions to the daemon's scoped UI executor", async () => {
    const { transport, calls } = recordingTransport(scopedActionBundle());
    const ui = daemonModule.daemonClient!(transport).ui!;

    await expect(ui.executeAction({
      surfaceId: "operator-control",
      actionId: "setup.oauth.start",
      scopeId: "scope-b",
    })).resolves.toEqual({ ok: true, message: "Setup action started." });

    expect(calls).toEqual([{
      kind: "strict",
      method: "POST",
      path: "/ui/actions/execute",
      body: {
        surfaceId: "operator-control",
        actionId: "setup.oauth.start",
        scopeId: "scope-b",
      },
    }]);
  });

  it("carries the projected scope through namespace, follow-up, and route actions", async () => {
    const { transport, calls } = recordingTransport(scopedActionBundle());
    const ui = daemonModule.daemonClient!(transport).ui!;

    await expect(ui.executeAction({
      surfaceId: "operator-control",
      actionId: "workflow.status",
      scopeId: "scope-b",
    })).resolves.toEqual({ ok: true, message: "Workflow status loaded." });

    await expect(ui.executeAction({
      surfaceId: "operator-control",
      actionId: "memory.list",
      scopeId: "scope-b",
    })).resolves.toEqual({ ok: true, message: "Memory loaded." });

    await expect(ui.executeAction({
      surfaceId: "operator-control",
      actionId: "workflow.retry",
      scopeId: "scope-b",
      parameters: { runId: "run-1" },
    })).resolves.toEqual({ ok: true, message: "Queued retry from run-1." });

    await expect(ui.executeAction({
      surfaceId: "operator-control",
      actionId: "workflow.launch",
      scopeId: "scope-b",
      parameters: { workflow: "builder" },
    })).resolves.toEqual({ ok: true, message: "Workflow queued." });

    expect(calls).toEqual([
      {
        kind: "strict",
        method: "GET",
        path: "/ui/surfaces?scopeId=scope-b",
        body: undefined,
      },
      {
        kind: "request",
        method: "GET",
        path: "/workflow/status?scopeId=scope-b",
        body: undefined,
      },
      {
        kind: "strict",
        method: "GET",
        path: "/ui/surfaces?scopeId=scope-b",
        body: undefined,
      },
      {
        kind: "request",
        method: "GET",
        path: "/api/memory?limit=10&scopeId=scope-b",
        body: undefined,
      },
      {
        kind: "strict",
        method: "GET",
        path: "/ui/surfaces?scopeId=scope-b",
        body: undefined,
      },
      {
        kind: "request",
        method: "GET",
        path: "/workflow/runs/run-1?scopeId=scope-b",
        body: undefined,
      },
      {
        kind: "request",
        method: "POST",
        path: "/workflow/trigger?scopeId=scope-b",
        body: {
          name: "builder",
          event: "autonomy.builder.recovery.requested",
          schemaRef: null,
          runId: expect.stringMatching(/-builder-/),
          payload: { source: "fixture", retryOf: "run-1" },
        },
      },
      {
        kind: "strict",
        method: "GET",
        path: "/ui/surfaces?scopeId=scope-b",
        body: undefined,
      },
      {
        kind: "request",
        method: "POST",
        path: "/workflow/trigger?scopeId=scope-b",
        body: { workflow: "builder" },
      },
    ]);
  });
});
