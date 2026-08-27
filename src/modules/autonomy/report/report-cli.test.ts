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

function writeTask(
  workspaceRoot: string,
  state: string,
  id: string,
  attrs: {
    priority: string;
    body?: string;
  },
): void {
  const dir = state === "done" || state === "dropped"
    ? join(workspaceRoot, "data", "tasks", "archive")
    : join(workspaceRoot, "data", "tasks");
  mkdirSync(dir, { recursive: true });
  const body = attrs.body ?? "## Problem\n\nTest body.\n";
  const content =
    `---\nstatus: ${state}\n` +
    `${state === "open" || state === "blocked" ? `priority: ${attrs.priority}\n` : ""}` +
    `---\n\n# ${id}\n\n${body}`;
  writeFileSync(join(dir, `${id}.md`), content, "utf-8");
}

function writeWatchlist(workspaceRoot: string, entries: readonly string[]): void {
  mkdirSync(join(workspaceRoot, "data"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "data", "watchlist.yaml"),
    ["resources:", ...entries, ""].join("\n"),
    "utf-8",
  );
}

function watchlistEntry(args: {
  url: string;
  summary?: string;
  lastSeen?: string;
}): string {
  const lines = [
    `  - url: ${args.url}`,
    '    added: "2026-07-01"',
  ];
  if (args.summary !== undefined && args.lastSeen !== undefined) {
    lines.push(
      "    snapshot:",
      "      fingerprint: sha256:test",
      `      summary: "${args.summary}"`,
      `      last_seen_at: "${args.lastSeen}"`,
    );
  }
  return lines.join("\n");
}

describe("kota report CLI", () => {
  let workspaceRoot: string;
  let origCwd: string;
  let origEnvKotaScopeRoot: string | undefined;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-report-cli-"));
    mkdirSync(join(workspaceRoot, ".kota", "runs"), { recursive: true });
    origCwd = process.cwd();
    origEnvKotaScopeRoot = process.env.KOTA_SCOPE_ROOT;
    delete process.env.KOTA_SCOPE_ROOT;
    process.chdir(workspaceRoot);
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (origEnvKotaScopeRoot !== undefined) {
      process.env.KOTA_SCOPE_ROOT = origEnvKotaScopeRoot;
    } else {
      delete process.env.KOTA_SCOPE_ROOT;
    }
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("renders the report from the current project state", async () => {
    writeTask(workspaceRoot, "open", "task-arch-1", {
      priority: "p1",
    });
    writeTask(workspaceRoot, "open", "task-client-1", {
      priority: "p2",
    });

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "report"]);
    });

    expect(out).toContain("Autonomy report");
    expect(out).toContain("Open queue");
    expect(out).toContain("Diff-summary consistency");
    expect(out).toContain("Owner interventions");
    expect(out).toContain("Total: 2");
    expect(out).toContain("By priority");
    expect(out).toContain("Control coverage");
    expect(out).toContain("Cost");
  });

  it("--json emits the structured report payload", async () => {
    writeTask(workspaceRoot, "open", "task-arch-1", {
      priority: "p1",
    });

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "report", "--json"]);
    });

    const parsed = JSON.parse(out.trim());
    expect(parsed.openQueue.total).toBe(1);
    expect(parsed.openQueue.byPriority).toEqual([{ priority: "p1", count: 1 }]);
    expect(parsed.windowDays).toBe(7);
    expect(Array.isArray(parsed.cost.byWorkflow)).toBe(true);
    expect(parsed.explorer.taskAdditions).toEqual([]);
    expect(parsed.reviewScrutiny).toMatchObject({
      totalReviews: 0,
      thinAcceptances: 0,
      absentMetricCount: 0,
      unsupportedArtifacts: 0,
    });
    expect(Array.isArray(parsed.trajectoryDiagnostics.activePatterns)).toBe(true);
    expect(parsed.ownerInterventions).toMatchObject({
      totalQuestions: 0,
      stalePending: 0,
      timeouts: 0,
      answeredCorrections: 0,
    });
    expect(parsed.diffSummaryConsistency).toMatchObject({
      totalBuilderRuns: 0,
      runsWithMismatches: 0,
    });
    expect(parsed.controlCoverage).toMatchObject({
      artifactCount: 0,
      totalGaps: 0,
    });
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

  it("renders focused source-to-decision coverage", async () => {
    writeWatchlist(workspaceRoot, [
      watchlistEntry({
        url: "https://example.com/adopted",
        summary: "Covered by task-done-source.",
        lastSeen: "2026-07-06T00:00:00.000Z",
      }),
      watchlistEntry({
        url: "https://example.com/open",
        summary: "Remaining local gap opened task-open-source.",
        lastSeen: "2026-07-06T00:00:00.000Z",
      }),
      watchlistEntry({
        url: "https://example.com/noop",
        summary: "No duplicate task is needed for KOTA.",
        lastSeen: "2026-07-06T00:00:00.000Z",
      }),
      watchlistEntry({ url: "https://example.com/unmapped" }),
    ]);
    writeTask(workspaceRoot, "done", "task-done-source", {
      priority: "p2",
      body:
        "## Problem\n\nFixture.\n\n## Source / Intent\n\nSource-to-decision refs: https://example.com/adopted\n",
    });
    writeTask(workspaceRoot, "open", "task-open-source", {
      priority: "p2",
      body:
        "## Problem\n\nFixture.\n\n## Source / Intent\n\nSource-to-decision refs: https://example.com/open\n",
    });

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync([
        "node",
        "kota",
        "report",
        "sources",
        "--limit",
        "4",
      ]);
    });

    expect(out).toContain("Source decision coverage");
    expect(out).toContain("adopt");
    expect(out).toContain("partial-adopt");
    expect(out).toContain("no-op");
    expect(out).toContain("needs-research");
    expect(out).toContain("covered-by-done-task");
    expect(out).toContain("covered-by-open-task");
    expect(out).toContain("local-decision");
    expect(out).toContain("unmapped");
  });

  it("emits source coverage JSON", async () => {
    writeWatchlist(workspaceRoot, [
      watchlistEntry({
        url: "https://example.com/adopted",
        summary: "Covered by task-done-source.",
        lastSeen: "2026-07-06T00:00:00.000Z",
      }),
    ]);
    writeTask(workspaceRoot, "done", "task-done-source", {
      priority: "p2",
      body:
        "## Problem\n\nFixture.\n\n## Source / Intent\n\nSource-to-decision refs: https://example.com/adopted\n",
    });

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync([
        "node",
        "kota",
        "report",
        "sources",
        "--json",
      ]);
    });

    const parsed = JSON.parse(out.trim());
    expect(parsed.records[0]).toMatchObject({
      source: "https://example.com/adopted",
      disposition: "adopt",
      coverageStatuses: ["covered-by-done-task"],
    });
  });
});
