import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReportCommand, collectAddedFilesBySha } from "./report-cli.js";

async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((data: string | Uint8Array) => {
      chunks.push(
        typeof data === "string" ? data : Buffer.from(data).toString("utf-8"),
      );
      return true;
    });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join("");
}

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.addCommand(buildReportCommand());
  return program;
}

function writeTask(
  projectDir: string,
  state: string,
  id: string,
  attrs: { priority: string; area: string; updatedAt?: string; body?: string },
): void {
  const dir = join(projectDir, "data", "tasks", state);
  mkdirSync(dir, { recursive: true });
  const updatedAt = attrs.updatedAt ?? new Date().toISOString();
  const body = attrs.body ?? "## Problem\n\nTest body.\n";
  const content =
    `---\nid: ${id}\ntitle: ${id}\nstatus: ${state}\npriority: ${attrs.priority}\n` +
    `area: ${attrs.area}\nsummary: t\ncreated_at: ${updatedAt}\nupdated_at: ${updatedAt}\n---\n\n${body}`;
  writeFileSync(join(dir, `${id}.md`), content, "utf-8");
}

function initSourceRepoWithAddedFile(dir: string): void {
  execFileSync("git", ["init", "--quiet"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "added.txt"), "added\n", "utf-8");
  execFileSync("git", ["add", "added.txt"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "--quiet", "-m", "seed"], { cwd: dir, stdio: "ignore" });
}

function createBareCloneWithHookConfig(dir: string): {
  bareDir: string;
  markerPath: string;
} {
  const sourceDir = join(dir, "source");
  const bareDir = join(dir, "nested.git");
  const hooksDir = join(dir, "malicious-hooks");
  const markerPath = join(dir, "hook-marker");
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(hooksDir, { recursive: true });
  initSourceRepoWithAddedFile(sourceDir);
  execFileSync("git", ["clone", "--bare", sourceDir, bareDir], {
    cwd: dir,
    stdio: "ignore",
  });
  const hookPath = join(hooksDir, "pre-commit");
  writeFileSync(hookPath, `#!/bin/sh\necho hook-ran > ${JSON.stringify(markerPath)}\n`, "utf8");
  chmodSync(hookPath, 0o755);
  execFileSync("git", ["--git-dir", bareDir, "config", "core.hooksPath", hooksDir], {
    cwd: dir,
    stdio: "ignore",
  });
  return { bareDir, markerPath };
}

describe("kota report CLI", () => {
  let projectDir: string;
  let origCwd: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-report-cli-"));
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
    origCwd = process.cwd();
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("renders the report from the current project state", async () => {
    writeTask(projectDir, "backlog", "task-arch-1", {
      priority: "p1",
      area: "architecture",
    });
    writeTask(projectDir, "backlog", "task-client-1", {
      priority: "p2",
      area: "client",
    });

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "report"]);
    });

    expect(out).toContain("Autonomy report");
    expect(out).toContain("Open queue");
    expect(out).toContain("Total: 2");
    expect(out).toContain("architecture");
    expect(out).toContain("client");
    expect(out).toContain("Cost");
  });

  it("--json emits the structured AutonomyReportData payload", async () => {
    writeTask(projectDir, "backlog", "task-arch-1", {
      priority: "p1",
      area: "architecture",
    });

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "report", "--json"]);
    });

    const parsed = JSON.parse(out.trim());
    expect(parsed.openQueue.total).toBe(1);
    expect(parsed.windowDays).toBe(7);
    expect(Array.isArray(parsed.cost.byWorkflow)).toBe(true);
    expect(parsed.explorer.byClassification).toHaveLength(3);
    expect(Array.isArray(parsed.trajectoryDiagnostics.activePatterns)).toBe(true);
  });

  it("respects --days override", async () => {
    const out = await captureStdout(async () => {
      await makeProgram().parseAsync([
        "node",
        "kota",
        "report",
        "--json",
        "--days",
        "14",
      ]);
    });
    const parsed = JSON.parse(out.trim());
    expect(parsed.windowDays).toBe(14);
  });

  it("rejects non-positive --days values", async () => {
    await expect(
      captureStdout(async () => {
        await makeProgram().parseAsync([
          "node",
          "kota",
          "report",
          "--days",
          "0",
        ]);
      }),
    ).rejects.toThrow(/--days must be a positive integer/);
  });

  it("rejects implicit nested bare repository discovery when collecting added files", () => {
    const { bareDir, markerPath } = createBareCloneWithHookConfig(projectDir);

    expect(collectAddedFilesBySha(bareDir, 0)).toEqual(new Map());
    expect(existsSync(markerPath)).toBe(false);
  });
});
