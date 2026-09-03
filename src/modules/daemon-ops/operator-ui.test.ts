import { describe, expect, it, vi } from "vitest";
import { renderToString } from "#modules/rendering/transport.js";
import type { OperatorInboxSnapshot } from "./operator-inbox.js";
import {
  buildInboxUiSurface,
  buildOperatorControlUiSurface,
  buildScopeUiSurface,
  buildStatusUiSurface,
  executeScopesUiAction,
  executeUiAction,
  renderUiSurface,
} from "./operator-ui.js";
import type { StatusSnapshot } from "./status-cli.js";
import { executeActionFromBundle } from "./ui-action-execution.js";

function status(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    daemonRunning: false,
    activeRuns: 0,
    queuedRuns: 2,
    workflowPaused: false,
    sessions: 0,
    pendingApprovals: 0,
    scopeRoot: "/repo",
    scopeName: "repo",
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
    scopeRoot: "/repo",
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
    expect(rendered).toContain("Approval required: shell.exec");
  });

  it("projects the complete Add Scope lifecycle through one generated UI contract", () => {
    const surface = buildScopeUiSurface({
      scopeId: "scope-current",
      scopes: {
        ok: true,
        value: {
          ok: true,
          scopes: [{ scopeId: "scope-current", displayName: "Current", scopeRoot: "/current" }],
          defaultScopeId: "scope-current",
          activeScopeId: "scope-current",
        },
      },
      sessions: { ok: true, value: { sessions: [] } },
    });
    expect(surface.actions.map((action) => action.actionId)).toEqual([
      "scopes.list",
      "scope.select",
      "scope.onboarding.inspect",
      "scope.onboarding.configure",
      "scope.onboarding.apply",
      "scope.onboarding.status",
      "scope.onboarding.retry",
      "scope.onboarding.cancel",
      "scope.drain",
      "scope.remove",
      "sessions.list",
      "session.autonomy.set",
    ]);
    const add = surface.actions.find((action) => action.actionId === "scope.onboarding.apply");
    expect(add).toMatchObject({
      label: "Add scope",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "scopes", method: "addOnboarding" },
      confirmation: { mode: "required", risk: "high" },
    });
    expect(add?.parameters?.schema.properties.directoryRoot).toMatchObject({
      type: "string",
      format: "path",
    });
    expect(add?.parameters?.schema.properties.initialAutomationMode).toMatchObject({
      default: "passive",
    });
    expect(add?.parameters?.schema.properties.writes).toMatchObject({ default: "none" });
    expect(surface.actions.find((action) => action.actionId === "scope.remove")?.confirmation)
      .toMatchObject({ detail: expect.stringContaining("never deletes the folder") });
  });

  it("applies Add Scope through the canonical plan and apply client operations", async () => {
    const plan = {
      planId: "plan-1",
      operationId: "operation-1",
      scopeId: "scope-external",
      changes: [],
      blockers: [],
      choices: {
        trust: true,
        initialAutomationMode: "autonomous",
        writes: { mode: "scope-directory" },
      },
    } as never;
    const planOnboarding = vi.fn(async () => ({ ok: true as const, plan }));
    const operation = {
      operationId: "operation-1",
      state: "succeeded",
      attempts: 1,
      mutations: [{
        kind: "register-scope",
        target: "scope-external",
        status: "applied",
      }],
      readiness: {
        registered: true,
        configured: true,
        trusted: true,
        workflowReady: true,
        blocked: false,
        partiallyApplied: false,
        reasons: [],
      },
      error: null,
    } as never;
    const applyOnboarding = vi.fn(async () => ({
      ok: true as const,
      operation,
    }));
    const result = await executeScopesUiAction(
      { planOnboarding, applyOnboarding } as never,
      "addOnboarding",
      {
        directoryRoot: "/daemon/external",
        trusted: true,
        initialAutomationMode: "autonomous",
        writes: "scope-directory",
      },
    );
    expect(planOnboarding).toHaveBeenCalledWith("/daemon/external", {
      trust: true,
      initialAutomationMode: "autonomous",
      writes: { mode: "scope-directory" },
    });
    expect(applyOnboarding).toHaveBeenCalledWith(plan, "confirm-dangerous");
    expect(result).toEqual({
      ok: true,
      message:
        "Operation operation-1: state=succeeded; attempts=1. " +
        "Readiness: registered=true; configured=true; trusted=true; workflow-ready=true; blocked=false; partially-applied=false. " +
        "Readiness reasons: none. Mutations: register-scope scope-external=applied. Error: none.",
    });
  });

  it("rejects a selected-paths write boundary without any selected paths", async () => {
    const planOnboarding = vi.fn();
    const result = await executeScopesUiAction(
      { planOnboarding } as never,
      "planOnboarding",
      {
        directoryRoot: "/daemon/external",
        writes: "paths",
      },
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid-input",
      message: "Selected paths requires at least one allowed path.",
    });
    expect(planOnboarding).not.toHaveBeenCalled();
  });

  it("uses the canonical onboarding decoder for direct namespace execution", async () => {
    const planOnboarding = vi.fn();
    const result = await executeScopesUiAction(
      { planOnboarding } as never,
      "planOnboarding",
      {
        directoryRoot: "/daemon/external",
        trusted: "yes",
        initialAutomationMode: "passive",
        writes: "none",
      },
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid-input",
      message: "onboarding plan request.choices.trust must be a boolean",
    });
    expect(planOnboarding).not.toHaveBeenCalled();
  });

  it("returns canonical setup, plan, mutation, readiness, and error details", async () => {
    const inspectionResult = await executeScopesUiAction(
      {
        inspectOnboarding: vi.fn(async () => ({
          ok: true,
          inspection: {
            operationId: "operation-1",
            displayName: "External",
            scopeId: "scope-external",
            directoryRoot: "/daemon/external",
            kind: "directory",
            registered: false,
            hostingState: null,
            trust: null,
            setup: [{
              moduleName: "github",
              requirementId: "token",
              state: "missing",
              message: "GitHub token is required.",
            }],
            blockers: [{
              code: "setup_missing",
              capability: "github.token",
              message: "GitHub token is required.",
            }],
          },
        })),
      } as never,
      "inspectOnboarding",
      { directoryRoot: "/daemon/external" },
    );
    expect(inspectionResult).toMatchObject({
      ok: true,
      message: expect.stringMatching(
        /operationId=operation-1.*Setup gaps: github.token=missing: GitHub token is required\./,
      ),
    });

    const planResult = await executeScopesUiAction(
      {
        planOnboarding: vi.fn(async () => ({
          ok: true,
          plan: {
            planId: "plan-1",
            operationId: "operation-1",
            directoryRoot: "/daemon/external",
            permissions: {
              trusted: false,
              autonomy: "passive",
              writes: { mode: "scope-directory" },
            },
            changes: [{
              kind: "create-runtime-directory",
              path: ".kota/runs",
            }],
            blockers: [{ code: "setup_missing", message: "GitHub token is required." }],
          },
        })),
      } as never,
      "planOnboarding",
      { directoryRoot: "/daemon/external", writes: "scope-directory" },
    );
    expect(planResult).toMatchObject({
      ok: true,
      message: expect.stringMatching(
        /Plan plan-1: operationId=operation-1.*Changes: create \.kota\/runs.*Blockers: \[setup_missing\] GitHub token is required/,
      ),
    });

    const statusResult = await executeScopesUiAction(
      {
        getOnboardingStatus: vi.fn(async () => ({
          ok: true,
          operation: {
            operationId: "operation-1",
            state: "incomplete",
            attempts: 2,
            readiness: {
              registered: true,
              configured: false,
              trusted: false,
              workflowReady: false,
              blocked: true,
              partiallyApplied: true,
              reasons: [{ code: "setup_missing", message: "GitHub token is required." }],
            },
            mutations: [{
              kind: "set-authority",
              target: "scope-external",
              status: "failed",
              message: "Authority store unavailable.",
            }],
            error: { code: "apply_failed", message: "Authority store unavailable." },
          },
        })),
      } as never,
      "getOnboardingStatus",
      { operationId: "operation-1" },
    );
    expect(statusResult).toMatchObject({
      ok: true,
      message: expect.stringMatching(
        /Readiness reasons: \[setup_missing\].*Mutations: set-authority.*Error: \[apply_failed\]/,
      ),
    });
  });

  it("returns the durable operation receipt when Add Scope apply fails", async () => {
    const plan = {
      planId: "plan-1",
      operationId: "operation-1",
      scopeId: "scope-external",
      blockers: [],
      choices: {
        trust: false,
        initialAutomationMode: "passive",
        writes: { mode: "none" },
      },
    } as never;
    const operation = {
      operationId: "operation-1",
      state: "incomplete",
      attempts: 1,
      readiness: {
        registered: true,
        configured: false,
        trusted: false,
        workflowReady: false,
        blocked: true,
        partiallyApplied: true,
        reasons: [],
      },
      mutations: [],
      error: { code: "apply_failed", message: "Authority store unavailable." },
    } as never;
    const result = await executeScopesUiAction(
      {
        planOnboarding: vi.fn(async () => ({ ok: true as const, plan })),
        applyOnboarding: vi.fn(async () => ({
          ok: false as const,
          reason: "apply_failed" as const,
          message: "Scope onboarding could not be completed.",
          operation,
        })),
      } as never,
      "addOnboarding",
      { directoryRoot: "/daemon/external" },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "apply_failed",
      message: expect.stringMatching(
        /Scope onboarding could not be completed\. Operation operation-1: state=incomplete.*Error: \[apply_failed\] Authority store unavailable\./,
      ),
    });
  });

  it("rejects Add Scope execution until the renderer records explicit confirmation", async () => {
    const surface = buildScopeUiSurface({
      scopeId: "scope-current",
      scopes: {
        ok: true,
        value: {
          ok: true,
          scopes: [],
          defaultScopeId: "scope-current",
          activeScopeId: "scope-current",
        },
      },
      sessions: { ok: true, value: { sessions: [] } },
    });
    const result = await executeActionFromBundle({
      bundle: { protocolVersion: "ui.surface.v1", surfaces: [surface] },
      input: {
        surfaceId: surface.surfaceId,
        actionId: "scope.onboarding.apply",
        scopeId: surface.scopeId,
        parameters: {
          directoryRoot: "/external",
          initialAutomationMode: "passive",
          writes: "none",
        },
      },
      clientNamespaceExecutor: () => async () => ({ ok: true, message: "unexpected" }),
      routeExecutor: () => async () => ({ ok: true, message: "unexpected" }),
    });
    expect(result).toEqual({
      ok: false,
      reason: "confirmation_required",
      message: "Add scope requires explicit confirmation.",
    });
  });

  it.each([
    ["trusted", "yes", "expected boolean, got string"],
    ["initialAutomationMode", "reckless", "expected one of"],
    ["writes", "anywhere", "expected one of"],
  ])("rejects malformed Add Scope %s before dispatch", async (
    field: string,
    value: string,
    expected: string,
  ) => {
    const surface = buildScopeUiSurface({
      scopeId: "scope-current",
      scopes: {
        ok: true,
        value: {
          ok: true,
          scopes: [],
          defaultScopeId: "scope-current",
          activeScopeId: "scope-current",
        },
      },
      sessions: { ok: true, value: { sessions: [] } },
    });
    const execute = vi.fn(async () => ({ ok: true as const, message: "unexpected" }));
    const result = await executeActionFromBundle({
      bundle: { protocolVersion: "ui.surface.v1", surfaces: [surface] },
      input: {
        surfaceId: surface.surfaceId,
        actionId: "scope.onboarding.apply",
        scopeId: surface.scopeId,
        parameters: {
          directoryRoot: "/external",
          trusted: false,
          initialAutomationMode: "passive",
          writes: "none",
          [field]: value,
        },
        confirmed: true,
      },
      clientNamespaceExecutor: () => execute,
      routeExecutor: () => async () => ({ ok: true, message: "unexpected" }),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid-input",
      message: expect.stringContaining(expected),
    });
    expect(execute).not.toHaveBeenCalled();
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
