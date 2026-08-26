import { describe, expect, it } from "vitest";
import { renderToString } from "#modules/rendering/transport.js";
import type { OperatorInboxSnapshot } from "./operator-inbox.js";
import {
  buildInboxUiSurface,
  buildOperatorControlUiSurface,
  buildStatusUiSurface,
  executeUiAction,
  renderUiSurface,
} from "./operator-ui.js";
import type { StatusSnapshot } from "./status-cli.js";

function status(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    daemonRunning: false,
    activeRuns: 0,
    queuedRuns: 2,
    workflowPaused: false,
    sessions: 0,
    pendingApprovals: 0,
    projectDir: "/repo",
    projectName: "repo",
    controlFile: { kind: "missing" },
    runProjection: {
      available: true,
      databasePath: "/repo/.kota/kota.sqlite",
      runs: [],
    },
    ...overrides,
  };
}

function inbox(overrides: Partial<OperatorInboxSnapshot> = {}): OperatorInboxSnapshot {
  return {
    projectDir: "/repo",
    generatedAt: "2026-06-12T08:00:00.000Z",
    items: [
      {
        kind: "runtime",
        id: "daemon-offline",
        title: "Daemon is offline",
        detail: "Dispatch, event stream, and live sessions are unavailable.",
        action: "kota daemon start",
        role: "warn",
      },
      {
        kind: "approval",
        id: "a1b2c3d4",
        title: "Approval required: shell.exec",
        detail: "dangerous: deploy",
        action: "kota approval list",
        role: "error",
      },
    ],
    counts: {
      runtime: 1,
      approval: 1,
      "owner-question": 0,
      "blocked-task": 0,
      setup: 0,
      "failed-run": 0,
    },
    ...overrides,
  };
}

describe("operator shared UI surfaces", () => {
  it("builds a typed Status surface with summary, warnings, and direct actions", () => {
    const surface = buildStatusUiSurface(status(), { explain: true });
    expect(surface.protocolVersion).toBe("ui.surface.v1");
    expect(surface.surfaceId).toBe("status");
    expect(surface.intent).toBe("Status");
    expect(surface.actions.map((action) => action.actionId)).toEqual([
      "daemon.start",
      "status.explain",
    ]);
    expect(surface.nodes.some((node) => node.kind === "status-summary")).toBe(true);
    expect(surface.nodes.some((node) => node.kind === "list" && node.title === "Warnings")).toBe(true);
  });

  it("builds a typed Inbox surface with item actions and an empty state arm", () => {
    const populated = buildInboxUiSurface(inbox());
    expect(populated.surfaceId).toBe("inbox");
    expect(populated.intent).toBe("Inbox");
    const list = populated.nodes.find((node) => node.kind === "list");
    expect(list?.items.map((item) => item.action?.actionId)).toContain("approval.open");
    const approval = list?.items.find((item) => item.id === "a1b2c3d4");
    expect(approval?.action?.operation).toEqual({
      kind: "daemon-route",
      method: "GET",
      path: "/approvals?status=pending",
    });
    expect(approval?.action?.effect).toBe("read");
    expect(approval?.action?.confirmation.mode).toBe("none");

    const clear = buildInboxUiSurface(inbox({ items: [] }));
    expect(clear.nodes.some((node) => node.kind === "empty")).toBe(true);
  });

  it("builds a richer shared operator-control surface with typed daemon actions", () => {
    const surface = buildOperatorControlUiSurface("p-kota-fixture-default");
    expect(surface.extensionId).toBe("demo.operator-control");
    expect(surface.attachmentPoint).toEqual({ kind: "intent", intent: "Work" });
    expect(surface.nodes.map((node) => node.kind)).toEqual([
      "metrics",
      "text",
      "link",
      "tabs",
      "table",
      "table",
      "progress",
      "log",
      "log-stream",
      "form",
      "form",
      "form",
      "table",
      "table",
      "action-list",
    ]);
    const link = surface.nodes.find((node) => node.kind === "link");
    expect(link?.target).toEqual({ kind: "daemon-route", path: "/ui/surfaces" });
    const tabs = surface.nodes.find((node) => node.kind === "tabs");
    expect(tabs?.tabs.map((tab) => tab.id)).toEqual(["requests", "runs", "setup"]);
    const stream = surface.nodes.find((node) => node.kind === "log-stream");
    expect(stream).toMatchObject({
      streamId: "daemon-events",
      source: { kind: "sse", path: "/events" },
    });
    const launch = surface.actions.find((candidate) => candidate.actionId === "workflow.launch");
    expect(launch?.operation).toEqual({ kind: "daemon-route", method: "POST", path: "/workflow/trigger" });
    expect(launch?.parameters?.schema.required).toEqual(["name"]);
    expect(launch?.parameters?.schema.properties).toHaveProperty("name");
    expect(launch?.parameters?.schema.properties).toHaveProperty("tags");
    expect(launch?.parameters?.schema.properties).toHaveProperty("payload");
    expect(launch?.parameters?.schema.properties).not.toHaveProperty("workflow");
    expect(launch?.parameters?.fields.map((field) => field.id)).toEqual(["name", "tags", "payload"]);
    expect(launch?.confirmation.mode).toBe("required");
    expect(launch?.readiness.state).toBe("ready");
    const session = surface.actions.find((candidate) => candidate.actionId === "session.launch");
    expect(session?.operation).toEqual({ kind: "daemon-route", method: "POST", path: "/sessions" });
    expect(session?.parameters?.schema.required).toEqual(["autonomy_mode"]);
    expect(session?.parameters?.schema.properties).toHaveProperty("autonomy_mode");
    expect(session?.parameters?.schema.properties).toHaveProperty("session_id");
    expect(session?.parameters?.schema.properties).toHaveProperty("conversation_id");
    expect(session?.parameters?.schema.properties).not.toHaveProperty("autonomyMode");
    expect(session?.parameters?.fields.map((field) => field.id)).toEqual(["autonomy_mode", "session_id", "conversation_id"]);
    const defaults = surface.actions.find((candidate) => candidate.actionId === "launch.defaults.configure");
    expect(defaults?.operation).toEqual({ kind: "client-namespace", namespace: "config", method: "set" });
    expect(defaults?.parameters?.schema.required).toEqual(["preset", "model", "effort"]);
    expect(defaults?.parameters?.schema.properties).toHaveProperty("preset");
    expect(defaults?.parameters?.schema.properties).toHaveProperty("model");
    expect(defaults?.parameters?.schema.properties).toHaveProperty("effort");
    expect(defaults?.readiness).toMatchObject({
      state: "disabled",
      reason: "controller-unavailable",
    });
    const setup = surface.actions.find((candidate) => candidate.actionId === "setup.oauth.start");
    expect(setup?.readiness).toMatchObject({
      state: "needs-setup",
      moduleName: "google-workspace",
      requirementId: "oauth-credentials",
    });
  });

  it("renders the shared Status and Inbox surfaces through the CLI renderer", () => {
    const rendered = renderToString(renderUiSurface(buildInboxUiSurface(inbox())), {
      width: 100,
    });
    expect(rendered).toContain("Inbox");
    expect(rendered).toContain("Daemon is offline");
    expect(rendered).toContain("GET /approvals?status=pending");
  });

  it("executes typed daemon-route UI actions through an injected route executor", async () => {
    const surface = buildOperatorControlUiSurface("p-kota-fixture-default");
    const refresh = surface.actions.find((candidate) => candidate.actionId === "ui.refresh");
    if (!refresh) throw new Error("fixture action missing");
    const result = await executeUiAction({
      action: refresh,
      routeExecutor: async (operation) => ({
        ok: true,
        message: `executed ${operation.method} ${operation.path}`,
      }),
    });
    expect(result).toEqual({ ok: true, message: "executed GET /ui/surfaces" });
  });

  it("executes the Status daemon.start client-namespace action through an injected namespace executor", async () => {
    const surface = buildStatusUiSurface(status());
    const start = surface.actions.find((candidate) => candidate.actionId === "daemon.start");
    if (!start) throw new Error("status daemon.start action missing");
    const seen: string[] = [];
    const result = await executeUiAction({
      action: start,
      clientNamespaceExecutor: async (operation) => {
        seen.push(`${operation.namespace}.${operation.method}`);
        return { ok: true, message: "Daemon start requested." };
      },
    });
    expect(seen).toEqual(["daemonOps.start"]);
    expect(result).toEqual({ ok: true, message: "Daemon start requested." });
  });

  it("executes needs-setup daemon-route UI actions so setup controls can start", async () => {
    const surface = buildOperatorControlUiSurface("p-kota-fixture-default");
    const setup = surface.actions.find((candidate) => candidate.actionId === "setup.oauth.start");
    if (!setup) throw new Error("fixture action missing");
    const result = await executeUiAction({
      action: setup,
      routeExecutor: async (operation) => ({
        ok: true,
        message: `executed ${operation.method} ${operation.path}`,
      }),
    });
    expect(result).toEqual({
      ok: true,
      message: "executed POST /setup/requirements/google-workspace/oauth-credentials/start",
    });
  });
});
