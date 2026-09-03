/**
 * `kota scope list` / `kota scope select` command surface tests.
 *
 * Pins the operator-facing behaviour:
 *  - `list` prints the configured scopes, marks the active one, and falls
 *    back gracefully when the daemon is offline.
 *  - `select <id>` calls `client.scopes.use(id)` and reports the new
 *    selection.
 *  - `select --clear` calls `client.scopes.use(null)` and reports the
 *    cleared selection.
 *  - `select` rejects unknown ids with a non-zero exit code.
 *  - The CLI rejects mutually exclusive `<id>` + `--clear` and missing
 *    arguments without round-tripping through the daemon.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopeOnboardingOperation } from "#core/daemon/scope-onboarding.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { ScopesClient } from "./client.js";
import { buildScopeCommand } from "./scopes-cli.js";

const confirmActionMock = vi.hoisted(() => vi.fn());

vi.mock("#core/util/confirm.js", () => ({
  confirmAction: confirmActionMock,
}));

function makeCtx(scopes: Partial<ScopesClient>): ModuleContext {
  return { client: { scopes } } as unknown as ModuleContext;
}

describe("kota scope CLI", () => {
  let logs: string[] = [];
  let errs: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    logs = [];
    errs = [];
    logSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      logs.push(String(data));
      return true;
    });
    errSpy = vi.spyOn(process.stderr, "write").mockImplementation((data) => {
      errs.push(String(data));
      return true;
    });
    confirmActionMock.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it("exposes canonical scope verbs without retired aliases", () => {
    const command = buildScopeCommand({ client: { scopes: {} } } as never);
    const names = command.commands.map((child) => child.name());
    expect(names).toEqual([
      "list",
      "select",
      "authority",
      "inspect",
      "configure",
      "add",
      "status",
      "retry",
      "cancel",
      "drain",
      "remove",
    ]);
    expect(names).not.toContain("ls");
    expect(names).not.toContain("use");
    expect(names).not.toContain("onboarding");
  });

  it("list --json prints scopes + active selection on a daemon-up call", async () => {
    const scopes = {
      list: vi.fn(async () => ({
        ok: true as const,
        defaultScopeId: "p1",
        activeScopeId: "p2",
        scopes: [
          { scopeId: "p1", scopeRoot: "/tmp/p1", displayName: "p1" },
          { scopeId: "p2", scopeRoot: "/tmp/p2", displayName: "p2" },
        ],
      })),
      use: vi.fn(),
    } as unknown as ScopesClient;
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync(["list", "--json"], { from: "user" });
    expect(JSON.parse(logs[0]!)).toEqual({
      defaultScopeId: "p1",
      activeScopeId: "p2",
      scopes: [
        { scopeId: "p1", scopeRoot: "/tmp/p1", displayName: "p1" },
        { scopeId: "p2", scopeRoot: "/tmp/p2", displayName: "p2" },
      ],
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("list reports daemon_required on the local-handler arm with exit code 1", async () => {
    const scopes = {
      list: vi.fn(async () => ({ ok: false as const, reason: "daemon_required" as const })),
      use: vi.fn(),
    } as unknown as ScopesClient;
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync(["list"], { from: "user" });
    expect(errs.join("\n")).toContain("Daemon is not running");
    expect(process.exitCode).toBe(1);
  });

  it("select <id> calls scopes.use and prints the new active selection", async () => {
    const scopes = {
      list: vi.fn(),
      use: vi.fn(async () => ({ ok: true as const, activeScopeId: "p2" })),
    } as unknown as ScopesClient;
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync(["select", "p2"], { from: "user" });
    expect(scopes.use).toHaveBeenCalledWith("p2");
    expect(logs.join("\n")).toContain("Active scope → p2");
    expect(process.exitCode).toBeUndefined();
  });

  it("select --clear calls scopes.use(null) and reports the cleared selection", async () => {
    const scopes = {
      list: vi.fn(),
      use: vi.fn(async () => ({ ok: true as const, activeScopeId: null })),
    } as unknown as ScopesClient;
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync(["select", "--clear"], { from: "user" });
    expect(scopes.use).toHaveBeenCalledWith(null);
    expect(logs.join("\n")).toContain("Active selection cleared");
  });

  it("select rejects unknown ids with a non-zero exit code", async () => {
    const scopes = {
      list: vi.fn(),
      use: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, scopeId: "ghost" })),
    } as unknown as ScopesClient;
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync(["select", "ghost"], { from: "user" });
    expect(errs.join("\n")).toContain("Unknown scope");
    expect(process.exitCode).toBe(1);
  });

  it("select rejects passing both <id> and --clear without calling the daemon", async () => {
    const scopes = {
      list: vi.fn(),
      use: vi.fn(),
    } as unknown as ScopesClient;
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync(["select", "p1", "--clear"], { from: "user" });
    expect(scopes.use).not.toHaveBeenCalled();
    expect(errs.join("\n")).toContain("Cannot pass both");
    expect(process.exitCode).toBe(1);
  });

  it("select without an id or --clear flag is rejected", async () => {
    const scopes = {
      list: vi.fn(),
      use: vi.fn(),
    } as unknown as ScopesClient;
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync(["select"], { from: "user" });
    expect(scopes.use).not.toHaveBeenCalled();
    expect(errs.join("\n")).toContain("Pass <scopeId> to switch");
    expect(process.exitCode).toBe(1);
  });

  it("configure delegates explicit operator choices to the scopes client", async () => {
    const planOnboarding = vi.fn(async () => ({
      ok: false as const,
      reason: "invalid_choices" as const,
      message: "fixture plan response",
    }));
    const scopes = {
      list: vi.fn(),
      use: vi.fn(),
      planOnboarding,
    } as unknown as ScopesClient;
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync([
      "configure",
      "/tmp/external",
      "--trusted",
      "--improvement",
      "propose",
      "--writes",
      "scope-directory",
      "--json",
    ], { from: "user" });

    expect(planOnboarding).toHaveBeenCalledWith("/tmp/external", {
      trust: true,
      improvementPosture: "propose",
      writes: { mode: "scope-directory" },
    });
    expect(JSON.parse(logs[0]!)).toEqual({
      ok: false,
      reason: "invalid_choices",
      message: "fixture plan response",
    });
  });

  it("sanitizes untrusted onboarding fields before terminal rendering", async () => {
    const directoryRoot = "/tmp/scope\x1b]8;;https://evil.invalid\x07\nchild";
    const inspection = {
      inspectionId: "inspection-1",
      operationId: "operation-1",
      scopeId: "scope-external",
      directoryRoot,
      displayName: "exter\x1b[31mnal\u202e",
      kind: "directory",
      registered: false,
      hostingState: null,
      trust: null,
      policyRevision: 0,
      policyFragment: null,
      policy: null,
      existing: {
        kotaState: false,
        scopeConfig: false,
        taskQueue: false,
        inbox: false,
        guidance: ["AG\x9b31mENTS.md"],
      },
      setup: [{
        moduleName: "provider",
        requirementId: "token",
        state: "missing",
        message: "Need token\r\nforged\x01",
      }],
      blockers: [{
        code: "setup_missing",
        message: "Blocked\x1b[2J\nready",
      }],
    } as never;
    const scopes = {
      inspectOnboarding: vi.fn(async () => ({ ok: true as const, inspection })),
    } as unknown as ScopesClient;

    await buildScopeCommand(makeCtx(scopes)).parseAsync(
      ["inspect", directoryRoot],
      { from: "user" },
    );

    const output = logs.join("");
    expect(output).toContain("Scope: external");
    expect(output).toContain("directory=/tmp/scope child");
    expect(output).toContain("guidance=AGENTS.md");
    expect(output).toContain("provider.token=missing: Need token forged");
    expect(output).toContain("[setup_missing] Blocked ready");
    for (const unsafe of ["\x1b", "\x9b", "\u202e", "\x01", "\r"]) {
      expect(output).not.toContain(unsafe);
    }
  });

  it("sanitizes the directory and plan id before the onboarding confirmation prompt", async () => {
    const directoryRoot = "/tmp/visible\x1b]0;spoof\x07\nconfirmed\u202e";
    const inspection = {
      inspectionId: "inspection-1",
      operationId: "operation-1",
      scopeId: "scope-external",
      directoryRoot,
      displayName: "external",
      kind: "directory",
      registered: false,
      hostingState: null,
      trust: null,
      existing: {
        kotaState: false,
        scopeConfig: false,
        taskQueue: false,
        inbox: false,
        guidance: [],
      },
      setup: [],
      blockers: [],
    } as never;
    const plan = {
      planId: "plan\x1b[31m-safe",
      operationId: "operation-1",
      inspectionId: "inspection-1",
      scopeId: "scope-external",
      directoryRoot,
      choices: {
        trust: false,
        improvementPosture: "observe",
        writes: { mode: "none" },
      },
      changes: [{ kind: "create-runtime-directory", path: `${directoryRoot}/.kota` }],
      permissions: {
        trusted: false,
        autonomy: "passive",
        writes: { mode: "none" },
        improvement: {
          posture: "observe",
          review: "disabled",
          builder: "disabled",
        },
      },
      blockers: [],
    } as never;
    const applyOnboarding = vi.fn();
    const scopes = {
      inspectOnboarding: vi.fn(async () => ({ ok: true as const, inspection })),
      getOnboardingStatus: vi.fn(async () => ({
        ok: false as const,
        reason: "not_found" as const,
      })),
      planOnboarding: vi.fn(async () => ({ ok: true as const, plan })),
      applyOnboarding,
    } as unknown as ScopesClient;
    confirmActionMock.mockResolvedValue(false);
    const originalSessionId = process.env.KOTA_SESSION_ID;
    delete process.env.KOTA_SESSION_ID;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });

    try {
      await buildScopeCommand(makeCtx(scopes)).parseAsync(
        ["add", directoryRoot],
        { from: "user" },
      );
    } finally {
      Reflect.deleteProperty(process.stdin, "isTTY");
      if (originalSessionId !== undefined) {
        process.env.KOTA_SESSION_ID = originalSessionId;
      }
    }

    expect(confirmActionMock).toHaveBeenCalledWith(
      "Apply onboarding plan plan-safe for /tmp/visible confirmed?",
    );
    expect(applyOnboarding).not.toHaveBeenCalled();
    expect(logs.join("")).not.toContain("\x1b");
    expect(logs.join("")).not.toContain("\u202e");
  });

  it("add --json keeps discovered existing state beside an idempotent operation", async () => {
    const directoryRoot = "/tmp/external";
    const inspection = {
      inspectionId: "inspection-1",
      operationId: "operation-1",
      scopeId: "scope-external",
      directoryRoot,
      displayName: "external",
      kind: "directory",
      registered: true,
      hostingState: "hosted",
      trust: { trusted: false, source: "default-untrusted" },
      policyRevision: 1,
      policyFragment: null,
      policy: null,
      existing: {
        kotaState: true,
        scopeConfig: true,
        taskQueue: true,
        inbox: true,
        guidance: ["AGENTS.md"],
      },
      setup: [],
      blockers: [],
    } as never;
    const plan = {
      planId: "plan-1",
      operationId: "operation-1",
      scopeId: "scope-external",
      directoryRoot,
      choices: {
        trust: false,
        initialAutomationMode: "passive",
        writes: { mode: "none" },
      },
    } as never;
    const operation = {
      operationId: "operation-1",
      state: "succeeded",
      acceptedPlan: plan,
      attempts: 1,
      mutations: [{
        kind: "register-scope",
        target: "scope-external",
        status: "applied",
      }],
      readiness: {
        registered: true,
        configured: true,
        trusted: false,
        workflowReady: false,
        blocked: true,
        partiallyApplied: false,
        reasons: [{
          code: "scope_untrusted",
          message: "Scope remains untrusted.",
        }],
      },
      error: null,
    } as never;
    const scopes = {
      inspectOnboarding: vi.fn(async () => ({ ok: true as const, inspection })),
      getOnboardingStatus: vi.fn(async () => ({ ok: true as const, operation })),
      planOnboarding: vi.fn(),
      applyOnboarding: vi.fn(),
    } as unknown as ScopesClient;

    await buildScopeCommand(makeCtx(scopes)).parseAsync(
      ["add", directoryRoot, "--json"],
      { from: "user" },
    );

    expect(scopes.planOnboarding).not.toHaveBeenCalled();
    expect(scopes.applyOnboarding).not.toHaveBeenCalled();
    expect(JSON.parse(logs[0]!)).toEqual({
      ok: true,
      operation,
      inspection,
    });
  });

  it("add replans a removed scope with its accepted choices and current inspection", async () => {
    const directoryRoot = "/tmp/external";
    const acceptedChoices = {
      displayName: "External scope",
      trust: true,
      initialAutomationMode: "supervised" as const,
      writes: { mode: "scope-directory" as const },
    };
    const inspection = {
      inspectionId: "inspection-current",
      operationId: "operation-1",
      scopeId: "scope-external",
      directoryRoot,
      displayName: "external",
      kind: "directory",
      registered: false,
      hostingState: null,
      trust: { trusted: true, source: "machine-config" },
      policyRevision: 2,
      policyFragment: null,
      policy: null,
      existing: {
        kotaState: true,
        scopeConfig: true,
        taskQueue: false,
        inbox: false,
        guidance: [],
      },
      setup: [],
      blockers: [],
    } as never;
    const acceptedPlan = {
      planId: "plan-original",
      operationId: "operation-1",
      scopeId: "scope-external",
      directoryRoot,
      choices: acceptedChoices,
    };
    const currentPlan = {
      ...acceptedPlan,
      planId: "plan-current",
      inspectionId: "inspection-current",
    };
    const planOnboarding = vi.fn(async () => ({
      ok: true as const,
      plan: currentPlan,
    }));
    const scopes = {
      inspectOnboarding: vi.fn(async () => ({ ok: true as const, inspection })),
      getOnboardingStatus: vi.fn(async () => ({
        ok: true as const,
        operation: {
          state: "succeeded",
          acceptedPlan,
          readiness: { registered: false },
        },
      })),
      planOnboarding,
      applyOnboarding: vi.fn(),
    } as unknown as ScopesClient;

    await buildScopeCommand(makeCtx(scopes)).parseAsync(
      ["add", directoryRoot, "--json"],
      { from: "user" },
    );

    expect(planOnboarding).toHaveBeenCalledWith(directoryRoot, acceptedChoices);
    expect(scopes.applyOnboarding).not.toHaveBeenCalled();
    expect(JSON.parse(logs[0]!)).toMatchObject({
      ok: false,
      reason: "invalid_input",
      inspection: { inspectionId: "inspection-current" },
      plan: { planId: "plan-current" },
    });
  });

  it("status renders durable progress, readiness reasons, mutations, and errors", async () => {
    const scopes = {
      getOnboardingStatus: vi.fn(async () => ({
        ok: true as const,
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
            improvement: {
              posture: "observe",
              review: "disabled",
              builder: "disabled",
              autonomyMode: "passive",
              writes: { mode: "none" },
            },
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
    } as unknown as ScopesClient;
    const cmd = buildScopeCommand(makeCtx(scopes));

    await cmd.parseAsync(["status", "operation-1"], { from: "user" });

    const output = logs.join("\n");
    expect(output).toContain("state=incomplete; attempts=2");
    expect(output).toContain("Readiness reasons: [setup_missing] GitHub token is required.");
    expect(output).toContain(
      "Mutations: set-authority scope-external=failed: Authority store unavailable.",
    );
    expect(output).toContain("Error: [apply_failed] Authority store unavailable.");
  });

  it("onboarding status explains live improvement authority and readiness blockers", async () => {
    const operation: ScopeOnboardingOperation = {
      schema: 2,
      operationId: "onboard_fixture",
      state: "succeeded",
      acceptedPlan: {
        schema: 2,
        planId: "plan_fixture",
        operationId: "onboard_fixture",
        inspectionId: "inspection_fixture",
        scopeId: "scope_fixture",
        directoryRoot: "/tmp/external",
        createdAt: "2026-09-03T00:00:00.000Z",
        choices: {
          displayName: "External",
          trust: true,
          improvementPosture: "build",
          writes: { mode: "scope-directory" },
        },
        registrationBaseline: {
          registered: false,
          displayName: "External",
          hostingState: null,
        },
        authorityBaseline: { revision: 0, trusted: false, policyFragment: null },
        changes: [],
        permissions: {
          trusted: true,
          autonomy: "autonomous",
          writes: { mode: "scope-directory" },
          improvement: {
            posture: "build",
            review: "task-proposals",
            builder: "enabled",
          },
        },
        blockers: [],
      },
      attempts: 1,
      registeredByOperation: true,
      authorityRevision: 2,
      authorityApplied: { revision: 1, auditId: "audit_fixture" },
      displayNameBefore: null,
      mutations: [],
      readiness: {
        scopeId: "scope_fixture",
        directoryRoot: "/tmp/external",
        registered: true,
        configured: true,
        trusted: true,
        workflowReady: false,
        blocked: true,
        partiallyApplied: false,
        improvement: {
          posture: "observe",
          review: "owner-questions",
          builder: "disabled",
          autonomyMode: "autonomous",
          writes: { mode: "scope-directory" },
        },
        reasons: [{
          code: "scope_improver_write_confirmation_required",
          capability: "scope-improvement-actions",
          message: "Owner confirmation is required for task-queue writes.",
        }],
      },
      provenance: {
        actor: "operator",
        acceptedAt: "2026-09-03T00:00:00.000Z",
        lastUpdatedAt: "2026-09-03T00:01:00.000Z",
      },
      error: null,
    };
    const scopes = {
      list: vi.fn(),
      use: vi.fn(),
      getOnboardingStatus: vi.fn(async () => ({ ok: true as const, operation })),
    } satisfies Partial<ScopesClient>;
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync(["status", operation.operationId], {
      from: "user",
    });

    const output = logs.join("\n");
    expect(output).toContain(
      "Improvement: observe, review=owner-questions, builder=disabled, " +
      "autonomy=autonomous, writes=scope-directory",
    );
    expect(output).toContain("Readiness blockers: 1");
    expect(output).toContain(
      "scope_improver_write_confirmation_required (scope-improvement-actions): " +
      "Owner confirmation is required for task-queue writes.",
    );
  });
});
