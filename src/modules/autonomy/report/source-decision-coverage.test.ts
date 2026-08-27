import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToString } from "#modules/rendering/transport.js";
import { renderSourceDecisionCoverageReport } from "./render-source-decision-coverage.js";
import {
  buildSourceDecisionCoverageReport,
  type SourceDecisionLocalMarker,
} from "./source-decision-coverage.js";

const NOW_MS = Date.parse("2026-07-07T00:00:00.000Z");

describe("source decision coverage report", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-source-coverage-"));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("groups source coverage by disposition and deterministic mapping status", () => {
    writeWatchlist(workspaceRoot, [
      watchlistEntry({
        url: "https://example.com/adopted",
        summary:
          "Covered by task-done-source and task-done-source; no duplicate task is needed.",
        lastSeen: "2026-07-06T00:00:00.000Z",
      }),
      watchlistEntry({
        url: "https://example.com/open",
        summary: "Remaining local gap opened task-open-source.",
        lastSeen: "2026-07-06T00:00:00.000Z",
      }),
      watchlistEntry({
        url: "https://example.com/rejected",
        summary: "Peer pattern was reviewed locally.",
        lastSeen: "2026-07-06T00:00:00.000Z",
      }),
      [
        "  - url: https://example.com/unmapped",
        '    added: "2026-07-01"',
      ].join("\n"),
    ]);
    writeTask(workspaceRoot, {
      state: "done",
      id: "task-done-source",
      title: "Done source task",
      body: sourceTaskBody("https://example.com/adopted"),
    });
    writeTask(workspaceRoot, {
      state: "open",
      id: "task-open-source",
      title: "Open source task",
      body: sourceTaskBody("https://example.com/open"),
    });

    const report = buildSourceDecisionCoverageReport({
      workspaceRoot,
      nowMs: NOW_MS,
      staleAfterDays: 30,
      localDecisionMarkers: [
        localDecision({
          sourceRefs: ["https://example.com/rejected"],
          disposition: "reject",
          summary: "Rejected in KOTA because the peer DSL duplicates workflow.",
        }),
      ],
    });

    expect(report.byDisposition).toEqual([
      { disposition: "adopt", count: 1 },
      { disposition: "partial-adopt", count: 1 },
      { disposition: "reject", count: 1 },
      { disposition: "watch", count: 0 },
      { disposition: "no-op", count: 0 },
      { disposition: "needs-research", count: 1 },
    ]);
    expect(report.byCoverageStatus).toEqual([
      { coverageStatus: "covered-by-done-task", count: 1 },
      { coverageStatus: "covered-by-open-task", count: 1 },
      { coverageStatus: "local-decision", count: 2 },
      { coverageStatus: "unmapped", count: 1 },
    ]);
    expect(record(report, "https://example.com/adopted").coveredByDoneTasks).toEqual([
      { id: "task-done-source", title: "Done source task", state: "done" },
    ]);
    expect(record(report, "https://example.com/open").remainingGap).toContain(
      "task-open-source",
    );
    expect(record(report, "https://example.com/rejected").coverageStatuses).toEqual([
      "local-decision",
    ]);
    expect(record(report, "https://example.com/unmapped").warnings).toEqual([
      {
        kind: "unverified-source-snapshot",
        message: "watchlist entry has no captured snapshot",
      },
    ]);
  });

  it("flags stale snapshots without inventing a task mapping", () => {
    writeWatchlist(workspaceRoot, [
      watchlistEntry({
        url: "https://example.com/stale",
        summary: "Monitor this source later.",
        lastSeen: "2026-05-01T00:00:00.000Z",
      }),
    ]);

    const report = buildSourceDecisionCoverageReport({
      workspaceRoot,
      nowMs: NOW_MS,
      staleAfterDays: 30,
      localDecisionMarkers: [],
    });

    expect(report.staleWarningCount).toBe(1);
    expect(record(report, "https://example.com/stale")).toMatchObject({
      disposition: "watch",
      coverageStatuses: ["local-decision"],
      warnings: [
        {
          kind: "stale-source-snapshot",
          message: "snapshot is 67 days old",
        },
      ],
    });
  });

  it("renders a sample section with adopted, open, rejected, and unmapped sources", () => {
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
        url: "https://example.com/rejected",
        summary: "Reviewed locally.",
        lastSeen: "2026-07-06T00:00:00.000Z",
      }),
      [
        "  - url: https://example.com/unmapped",
        '    added: "2026-07-01"',
      ].join("\n"),
    ]);
    writeTask(workspaceRoot, {
      state: "done",
      id: "task-done-source",
      title: "Done source task",
      body: sourceTaskBody("https://example.com/adopted"),
    });
    writeTask(workspaceRoot, {
      state: "open",
      id: "task-open-source",
      title: "Open source task",
      body: sourceTaskBody("https://example.com/open"),
    });

    const text = renderToString(
      renderSourceDecisionCoverageReport(
        buildSourceDecisionCoverageReport({
          workspaceRoot,
          nowMs: NOW_MS,
          localDecisionMarkers: [
            localDecision({
              sourceRefs: ["https://example.com/rejected"],
              disposition: "reject",
              summary: "Rejected in KOTA because the peer DSL duplicates workflow.",
            }),
          ],
        }),
      ),
      { width: 120 },
    );

    expect(text).toContain("adopt (1)");
    expect(text).toContain("partial-adopt (1)");
    expect(text).toContain("reject (1)");
    expect(text).toContain("needs-research (1)");
    expect(text).toContain("covered-by-done-task");
    expect(text).toContain("covered-by-open-task");
    expect(text).toContain("local-decision");
    expect(text).toContain("unmapped");
  });
});

function writeWatchlist(workspaceRoot: string, entries: readonly string[]): void {
  const dataDir = join(workspaceRoot, "data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "watchlist.yaml"),
    ["resources:", ...entries, ""].join("\n"),
    "utf-8",
  );
}

function watchlistEntry(args: {
  url: string;
  summary: string;
  lastSeen: string;
}): string {
  return [
    `  - url: ${args.url}`,
    '    added: "2026-07-01"',
    "    snapshot:",
    "      fingerprint: sha256:test",
    `      summary: "${args.summary}"`,
    `      last_seen_at: "${args.lastSeen}"`,
  ].join("\n");
}

function writeTask(workspaceRoot: string, args: {
  state: "open" | "done";
  id: string;
  title: string;
  body: string;
}): void {
  const dir = args.state === "done"
    ? join(workspaceRoot, "data", "tasks", "archive")
    : join(workspaceRoot, "data", "tasks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${args.id}.md`),
    [
      "---",
      `status: ${args.state}`,
      ...(args.state === "open" ? ["priority: p2"] : []),
      "---",
      "",
      `# ${args.title}`,
      "",
      args.body,
    ].join("\n"),
    "utf-8",
  );
}

function sourceTaskBody(source: string): string {
  return [
    "## Problem",
    "",
    "Fixture problem.",
    "",
    "## Source / Intent",
    "",
    `Source-to-decision refs: ${source}`,
  ].join("\n");
}

function localDecision(args: {
  sourceRefs: readonly string[];
  disposition: SourceDecisionLocalMarker["disposition"];
  summary: string;
}): SourceDecisionLocalMarker {
  return {
    sourceRefs: args.sourceRefs,
    disposition: args.disposition,
    summary: args.summary,
    refs: ["src/modules/autonomy/external-pattern-decisions.ts"],
  };
}

function record(
  report: ReturnType<typeof buildSourceDecisionCoverageReport>,
  source: string,
) {
  const found = report.records.find((candidate) => candidate.source === source);
  if (found === undefined) throw new Error(`missing record ${source}`);
  return found;
}
