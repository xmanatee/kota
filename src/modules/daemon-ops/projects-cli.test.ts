/**
 * `kota project ls` / `kota project use` command surface tests.
 *
 * Pins the operator-facing behaviour:
 *  - `ls` prints the configured projects, marks the active one, and falls
 *    back gracefully when the daemon is offline.
 *  - `use <id>` calls `client.projects.use(id)` and reports the new
 *    selection.
 *  - `use --clear` calls `client.projects.use(null)` and reports the
 *    cleared selection.
 *  - `use` rejects unknown ids with a non-zero exit code.
 *  - The CLI rejects mutually exclusive `<id>` + `--clear` and missing
 *    arguments without round-tripping through the daemon.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { ProjectsClient } from "./client.js";
import { buildProjectCommand } from "./projects-cli.js";

function makeCtx(projects: ProjectsClient): ModuleContext {
  return { client: { projects } } as unknown as ModuleContext;
}

describe("kota project CLI", () => {
  let logs: string[] = [];
  let errs: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    logs = [];
    errs = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
    errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it("ls --json prints projects + active selection on a daemon-up call", async () => {
    const projects: ProjectsClient = {
      list: vi.fn(async () => ({
        ok: true as const,
        defaultProjectId: "p1",
        activeProjectId: "p2",
        projects: [
          { projectId: "p1", projectDir: "/tmp/p1", displayName: "p1" },
          { projectId: "p2", projectDir: "/tmp/p2", displayName: "p2" },
        ],
      })),
      use: vi.fn(),
    };
    const cmd = buildProjectCommand(makeCtx(projects));
    await cmd.parseAsync(["ls", "--json"], { from: "user" });
    expect(JSON.parse(logs[0]!)).toEqual({
      defaultProjectId: "p1",
      activeProjectId: "p2",
      projects: [
        { projectId: "p1", projectDir: "/tmp/p1", displayName: "p1" },
        { projectId: "p2", projectDir: "/tmp/p2", displayName: "p2" },
      ],
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("ls reports daemon_required on the local-handler arm with exit code 1", async () => {
    const projects: ProjectsClient = {
      list: vi.fn(async () => ({ ok: false as const, reason: "daemon_required" as const })),
      use: vi.fn(),
    };
    const cmd = buildProjectCommand(makeCtx(projects));
    await cmd.parseAsync(["ls"], { from: "user" });
    expect(errs.join("\n")).toContain("Daemon is not running");
    expect(process.exitCode).toBe(1);
  });

  it("use <id> calls projects.use and prints the new active selection", async () => {
    const projects: ProjectsClient = {
      list: vi.fn(),
      use: vi.fn(async () => ({ ok: true as const, activeProjectId: "p2" })),
    };
    const cmd = buildProjectCommand(makeCtx(projects));
    await cmd.parseAsync(["use", "p2"], { from: "user" });
    expect(projects.use).toHaveBeenCalledWith("p2");
    expect(logs.join("\n")).toContain("Active project → p2");
    expect(process.exitCode).toBeUndefined();
  });

  it("use --clear calls projects.use(null) and reports the cleared selection", async () => {
    const projects: ProjectsClient = {
      list: vi.fn(),
      use: vi.fn(async () => ({ ok: true as const, activeProjectId: null })),
    };
    const cmd = buildProjectCommand(makeCtx(projects));
    await cmd.parseAsync(["use", "--clear"], { from: "user" });
    expect(projects.use).toHaveBeenCalledWith(null);
    expect(logs.join("\n")).toContain("Active selection cleared");
  });

  it("use rejects unknown ids with a non-zero exit code", async () => {
    const projects: ProjectsClient = {
      list: vi.fn(),
      use: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, projectId: "ghost" })),
    };
    const cmd = buildProjectCommand(makeCtx(projects));
    await cmd.parseAsync(["use", "ghost"], { from: "user" });
    expect(errs.join("\n")).toContain("Unknown project");
    expect(process.exitCode).toBe(1);
  });

  it("use rejects passing both <id> and --clear without calling the daemon", async () => {
    const projects: ProjectsClient = {
      list: vi.fn(),
      use: vi.fn(),
    };
    const cmd = buildProjectCommand(makeCtx(projects));
    await cmd.parseAsync(["use", "p1", "--clear"], { from: "user" });
    expect(projects.use).not.toHaveBeenCalled();
    expect(errs.join("\n")).toContain("Cannot pass both");
    expect(process.exitCode).toBe(1);
  });

  it("use without an id or --clear flag is rejected", async () => {
    const projects: ProjectsClient = {
      list: vi.fn(),
      use: vi.fn(),
    };
    const cmd = buildProjectCommand(makeCtx(projects));
    await cmd.parseAsync(["use"], { from: "user" });
    expect(projects.use).not.toHaveBeenCalled();
    expect(errs.join("\n")).toContain("Pass <projectId> to switch");
    expect(process.exitCode).toBe(1);
  });
});
