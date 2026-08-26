import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatStatusOutput, type StatusSnapshot } from "./status-cli.js";

function makeSnap(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    daemonRunning: true,
    daemonPid: 4242,
    daemonUptimeMs: 60_000,
    activeRuns: 1,
    queuedRuns: 2,
    workflowPaused: false,
    sessions: 1,
    pendingApprovals: 0,
    scopeRoot: "/Users/op/Desktop/mono/apps/kota",
    scopeName: "kota",
    controlFile: { kind: "fresh", pid: 4242, baseURL: "http://127.0.0.1:8765" },
    daemonScopeRoot: "/Users/op/Desktop/mono/apps/kota",
    daemonScopeName: "kota",
    dashboard: { available: true, url: "http://127.0.0.1:8765/" },
    runProjection: {
      available: true,
      databasePath: "/Users/op/Desktop/mono/apps/kota/.kota/kota.sqlite",
      runs: [],
    },
    ...overrides,
  };
}

function writeSandboxRun(
  overrides: Partial<StatusSnapshot["runProjection"]["runs"][number]> = {},
): StatusSnapshot["runProjection"]["runs"][number] {
  return {
    runId: "run-active",
    scopeId: "scope-kota",
    workflow: "builder",
    state: "running",
    resources: ["repository:write", "port:41000-41019"],
    processes: [{ processKey: "agent", pid: 4217 }],
    wait: null,
    lastError: null,
    sandbox: {
      runId: "run-active",
      repository: "write",
      rootDir: "/repo/.kota/runtime/run-active",
      workspaceDir: "/repo/.worktrees/runs/run-active/workspace",
      tempDir: "/repo/.kota/runtime/run-active/temp",
      artifactDir: "/repo/.kota/runtime/run-active/artifacts",
      branch: "kota/run/run-active",
      baseCommit: "1111111111111111111111111111111111111111",
      workspace: {
        available: true,
        headCommit: "2222222222222222222222222222222222222222",
        dirty: true,
        dirtySummary: "M src/core/workflow/runtime.ts",
      },
    },
    ...overrides,
  };
}

function runSnapshot(): StatusSnapshot {
  return makeSnap({
    runProjection: {
      available: true,
      databasePath: "/repo/.kota/kota.sqlite",
      runs: [
        writeSandboxRun(),
        writeSandboxRun({
          runId: "run-queued",
          state: "queued",
          resources: ["repository:write"],
          processes: [],
          sandbox: null,
        }),
        writeSandboxRun({
          runId: "run-waiting",
          workflow: "owner-gated",
          state: "waiting",
          resources: ["repository:read"],
          processes: [],
          wait: { kind: "approval", approvalId: "approval-17" },
          sandbox: {
            runId: "run-waiting",
            repository: "read",
            rootDir: "/repo/.kota/runtime/run-waiting",
            workspaceDir: "/repo/.worktrees/runs/run-waiting/workspace",
            tempDir: "/repo/.kota/runtime/run-waiting/temp",
            artifactDir: "/repo/.kota/runtime/run-waiting/artifacts",
            branch: null,
            baseCommit: "3333333333333333333333333333333333333333",
            workspace: {
              available: true,
              headCommit: "3333333333333333333333333333333333333333",
              dirty: false,
              dirtySummary: "clean",
            },
          },
        }),
        writeSandboxRun({
          runId: "run-attention",
          workflow: "publisher",
          state: "needs_attention",
          resources: [],
          processes: [{ processKey: "publisher", status: "unknown" }],
          wait: { kind: "operator" },
          lastError: "process identity could not be recovered",
          sandbox: {
            runId: "run-attention",
            repository: "none",
            rootDir: "/repo/.kota/runtime/run-attention",
            workspaceDir: "/repo/.kota/runtime/run-attention/workspace",
            tempDir: "/repo/.kota/runtime/run-attention/temp",
            artifactDir: "/repo/.kota/runtime/run-attention/artifacts",
            branch: null,
            baseCommit: null,
            workspace: null,
          },
        }),
      ],
    },
  });
}

function locateRunDir(): string | null {
  const env = process.env.KOTA_RUN_DIR;
  if (env) return env;
  const runs = join(process.cwd(), ".kota", "runs");
  if (!existsSync(runs)) return null;
  const entries = readdirSync(runs)
    .map((name) => ({ name, full: join(runs, name) }))
    .filter((entry) => statSync(entry.full).isDirectory())
    .sort((a, b) => statSync(b.full).mtimeMs - statSync(a.full).mtimeMs);
  return entries[0]?.full ?? null;
}

describe("formatStatusOutput run sandboxes", () => {
  it("renders durable state, resources, processes, sandbox Git evidence, wait, and error", () => {
    const out = formatStatusOutput(runSnapshot());

    expect(out).toContain("Run sandboxes");
    expect(out).toContain("running");
    expect(out).toContain("queued");
    expect(out).toContain("waiting");
    expect(out).toContain("needs_attention");
    expect(out).toContain("repository:write");
    expect(out).toContain('{"processKey":"agent","pid":4217}');
    expect(out).toContain("kota/run/run-active");
    expect(out).toContain("1111111111111111111111111111111111111111");
    expect(out).toContain("2222222222222222222222222222222222222222");
    expect(out).toContain("M src/core/workflow/runtime.ts");
    expect(out).toContain('{"kind":"approval","approvalId":"approval-17"}');
    expect(out).toContain("process identity could not be recovered");
    expect(out).toContain("not allocated");
    expect(out).not.toContain("pending-merge");
    expect(out).not.toContain("Cleanup eligible");
    expect(out).not.toContain("Metadata");
  });

  it("reports unavailable live Git evidence without inventing branch state", () => {
    const run = writeSandboxRun();
    if (run.sandbox?.repository !== "write") throw new Error("Expected a write sandbox fixture");
    const out = formatStatusOutput(makeSnap({
      runProjection: {
        available: true,
        databasePath: "/repo/.kota/kota.sqlite",
        runs: [
          writeSandboxRun({
            sandbox: {
              ...run.sandbox,
              workspace: {
                available: false,
                headCommit: null,
                dirty: null,
                dirtySummary: "git status unavailable: workspace missing",
              },
            },
          }),
        ],
      },
    }));

    expect(out).toContain("git status unavailable: workspace missing");
    expect(out).toContain("Head");
    expect(out).toContain("unavailable");
  });

  it("shows when the durable projection database is unavailable", () => {
    const out = formatStatusOutput(makeSnap({
      runProjection: {
        available: false,
        databasePath: "/repo/.kota/kota.sqlite",
        runs: [],
      },
    }));

    expect(out).toContain("Run sandboxes");
    expect(out).toContain("Projection");
    expect(out).toContain("unavailable");
    expect(out).toContain("/repo/.kota/kota.sqlite");
  });

  it("writes a deterministic CLI transcript for the durable run projection", () => {
    const transcript = [
      "# CLI transcript: kota status run sandboxes",
      "# Generated by status-cli-worktrees.test.ts (deterministic, no daemon spawn).",
      "",
      "$ kota status",
      formatStatusOutput(runSnapshot()),
      "",
    ].join("\n");
    expect(transcript).toContain("run-active");
    expect(transcript).toContain("run-queued");
    expect(transcript).toContain("run-attention");

    const runDir = locateRunDir();
    if (!runDir) return;
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "cli-run-sandbox-status-transcript.txt"), transcript);
  });
});
