/**
 * `kota scope ls` / `kota scope use` command surface tests.
 *
 * Pins the operator-facing behaviour:
 *  - `ls` prints the configured scopes, marks the active one, and falls
 *    back gracefully when the daemon is offline.
 *  - `use <id>` calls `client.scopes.use(id)` and reports the new
 *    selection.
 *  - `use --clear` calls `client.scopes.use(null)` and reports the
 *    cleared selection.
 *  - `use` rejects unknown ids with a non-zero exit code.
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

  it("ls --json prints scopes + active selection on a daemon-up call", async () => {
    const scopes: ScopesClient = {
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
    };
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync(["ls", "--json"], { from: "user" });
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

  it("ls reports daemon_required on the local-handler arm with exit code 1", async () => {
    const scopes: ScopesClient = {
      list: vi.fn(async () => ({ ok: false as const, reason: "daemon_required" as const })),
      use: vi.fn(),
    };
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync(["ls"], { from: "user" });
    expect(errs.join("\n")).toContain("Daemon is not running");
    expect(process.exitCode).toBe(1);
  });

  it("use <id> calls scopes.use and prints the new active selection", async () => {
    const scopes: ScopesClient = {
      list: vi.fn(),
      use: vi.fn(async () => ({ ok: true as const, activeScopeId: "p2" })),
    };
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync(["use", "p2"], { from: "user" });
    expect(scopes.use).toHaveBeenCalledWith("p2");
    expect(logs.join("\n")).toContain("Active scope → p2");
    expect(process.exitCode).toBeUndefined();
  });

  it("use --clear calls scopes.use(null) and reports the cleared selection", async () => {
    const scopes: ScopesClient = {
      list: vi.fn(),
      use: vi.fn(async () => ({ ok: true as const, activeScopeId: null })),
    };
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync(["use", "--clear"], { from: "user" });
    expect(scopes.use).toHaveBeenCalledWith(null);
    expect(logs.join("\n")).toContain("Active selection cleared");
  });

  it("use rejects unknown ids with a non-zero exit code", async () => {
    const scopes: ScopesClient = {
      list: vi.fn(),
      use: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, scopeId: "ghost" })),
    };
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync(["use", "ghost"], { from: "user" });
    expect(errs.join("\n")).toContain("Unknown scope");
    expect(process.exitCode).toBe(1);
  });

  it("use rejects passing both <id> and --clear without calling the daemon", async () => {
    const scopes: ScopesClient = {
      list: vi.fn(),
      use: vi.fn(),
    };
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync(["use", "p1", "--clear"], { from: "user" });
    expect(scopes.use).not.toHaveBeenCalled();
    expect(errs.join("\n")).toContain("Cannot pass both");
    expect(process.exitCode).toBe(1);
  });

  it("use without an id or --clear flag is rejected", async () => {
    const scopes: ScopesClient = {
      list: vi.fn(),
      use: vi.fn(),
    };
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync(["use"], { from: "user" });
    expect(scopes.use).not.toHaveBeenCalled();
    expect(errs.join("\n")).toContain("Pass <scopeId> to switch");
    expect(process.exitCode).toBe(1);
  });

  it("onboarding plan delegates explicit operator choices to the scopes client", async () => {
    const planOnboarding = vi.fn(async () => ({
      ok: false as const,
      reason: "invalid_choices" as const,
      message: "fixture plan response",
    }));
    const scopes: ScopesClient = {
      list: vi.fn(),
      use: vi.fn(),
      planOnboarding,
    };
    const cmd = buildScopeCommand(makeCtx(scopes));
    await cmd.parseAsync([
      "onboarding",
      "plan",
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
});
