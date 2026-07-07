import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReportCommand } from "./report-cli.js";

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

function writeTask(projectDir: string, id: string): void {
  const dir = join(projectDir, "data", "tasks", "backlog");
  mkdirSync(dir, { recursive: true });
  const updatedAt = new Date("2026-07-07T12:00:00.000Z").toISOString();
  const content =
    `---\nid: ${id}\ntitle: ${id}\nstatus: backlog\npriority: p1\n` +
    `area: architecture\nsummary: t\ncreated_at: ${updatedAt}\n` +
    `updated_at: ${updatedAt}\n---\n\n## Problem\n\nTest body.\n`;
  writeFileSync(join(dir, `${id}.md`), content, "utf-8");
}

describe("kota report CLI supervision load", () => {
  let projectDir: string;
  let origCwd: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-report-cli-load-"));
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
    origCwd = process.cwd();
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("renders the supervision-load section", async () => {
    writeTask(projectDir, "task-arch-1");

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "report"]);
    });

    expect(out).toContain("Supervision load");
    expect(out).toContain("Status:");
    expect(out).toContain("active runs");
  });

  it("--json emits the structured supervision-load payload", async () => {
    writeTask(projectDir, "task-arch-1");

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "report", "--json"]);
    });

    const parsed = JSON.parse(out.trim());
    expect(parsed.supervisionLoad).toMatchObject({
      status: "unknown",
      counts: {
        activeRuns: 0,
        activeTaskClaims: null,
        pendingApprovals: null,
        pendingOwnerQuestions: null,
        openDeadLetters: null,
      },
      thresholds: {
        busyAt: 3,
        overloadedAt: 6,
      },
    });
    expect(parsed.supervisionLoad.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "task-claims", status: "missing" }),
        expect.objectContaining({ source: "approvals", status: "missing" }),
        expect.objectContaining({
          source: "owner-questions",
          status: "missing",
        }),
        expect.objectContaining({ source: "dead-letters", status: "missing" }),
      ]),
    );
  });
});
