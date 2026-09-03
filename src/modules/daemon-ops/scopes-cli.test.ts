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
import type { ModuleContext } from "#core/modules/module-types.js";
import type { ScopesClient } from "./client.js";
import { buildScopeCommand } from "./scopes-cli.js";

function makeCtx(scopes: ScopesClient): ModuleContext {
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
      "--automation",
      "supervised",
      "--writes",
      "scope-directory",
      "--json",
    ], { from: "user" });

    expect(planOnboarding).toHaveBeenCalledWith("/tmp/external", {
      trust: true,
      initialAutomationMode: "supervised",
      writes: { mode: "scope-directory" },
    });
    expect(JSON.parse(logs[0]!)).toEqual({
      ok: false,
      reason: "invalid_choices",
      message: "fixture plan response",
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
});
