import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyDaemonControlFile,
  formatStatusOutput,
  resolveDashboardForStatus,
  type StatusSnapshot,
} from "./status-cli.js";

function makeSnap(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    daemonRunning: false,
    activeRuns: 0,
    queuedRuns: 0,
    sessions: 0,
    pendingApprovals: 0,
    projectDir: "/Users/op/Desktop/mono/apps/kota",
    projectName: "kota",
    controlFile: { kind: "missing" },
    ...overrides,
  };
}

describe("formatStatusOutput", () => {
  it("shows daemon as not running when offline", () => {
    const out = formatStatusOutput(makeSnap());
    expect(out).toContain("not running");
    expect(out).toContain("offline mode");
  });

  it("shows daemon as running with pid and uptime", () => {
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 12345,
      daemonUptimeMs: 2 * 60 * 60 * 1000 + 14 * 60 * 1000,
      controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
    }));
    expect(out).toContain("running");
    expect(out).toContain("pid 12345");
    expect(out).toContain("2h 14m");
  });

  it("shows active and queued run counts", () => {
    const out = formatStatusOutput(makeSnap({ activeRuns: 2, queuedRuns: 3 }));
    expect(out).toContain("2 active, 3 queued");
  });

  it("shows session count", () => {
    const out = formatStatusOutput(makeSnap({ sessions: 1 }));
    expect(out).toContain("1 interactive");
  });

  it("marks pending approvals with attention note", () => {
    const out = formatStatusOutput(makeSnap({ pendingApprovals: 1 }));
    expect(out).toContain("1 pending");
    expect(out).toContain("requires attention");
  });

  it("shows no attention note when approvals are zero", () => {
    const out = formatStatusOutput(makeSnap({ pendingApprovals: 0 }));
    expect(out).toContain("0 pending");
    expect(out).not.toContain("requires attention");
  });

  it("formats uptime under one hour as minutes only", () => {
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 1,
      daemonUptimeMs: 45 * 60 * 1000,
      controlFile: { kind: "fresh", pid: 1, baseURL: "http://127.0.0.1:8765" },
    }));
    expect(out).toContain("45m");
    expect(out).not.toContain("0h");
  });

  it("shows the project name and directory at the top of the snapshot", () => {
    const out = formatStatusOutput(makeSnap());
    expect(out).toContain("kota");
    expect(out).toContain("/Users/op/Desktop/mono/apps/kota");
    expect(out).toContain("Project");
  });

  it("reports a missing control file in the offline branch", () => {
    const out = formatStatusOutput(makeSnap({ controlFile: { kind: "missing" } }));
    expect(out).toContain("missing");
    expect(out).toContain("daemon-control.json");
  });

  it("reports a stale control file with the doctor hint and base URL", () => {
    const out = formatStatusOutput(makeSnap({
      controlFile: { kind: "stale", pid: 99999, baseURL: "http://127.0.0.1:8765" },
    }));
    expect(out).toContain("stale");
    expect(out).toContain("pid 99999");
    expect(out).toContain("kota doctor --fix");
    expect(out).toContain("http://127.0.0.1:8765");
  });

  it("reports a fresh control file and the daemon URL when running", () => {
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 12345,
      controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
    }));
    expect(out).toContain("fresh");
    expect(out).toContain("http://127.0.0.1:8765");
    expect(out).toContain("Daemon URL");
  });

  it("flags a wrong-project mismatch when daemon /identity reports another project", () => {
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 12345,
      controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
      projectDir: "/Users/op/Desktop/other-project",
      projectName: "other-project",
      daemonProjectDir: "/Users/op/Desktop/mono/apps/kota",
      daemonProjectName: "kota",
      wrongProject: true,
    }));
    expect(out).toContain("Daemon project");
    expect(out).toContain("/Users/op/Desktop/mono/apps/kota");
    expect(out).toContain("MISMATCH");
  });

  it("shows the daemon's project alongside the selected project when they match", () => {
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 12345,
      controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
      daemonProjectDir: "/Users/op/Desktop/mono/apps/kota",
      daemonProjectName: "kota",
    }));
    expect(out).toContain("Daemon project");
    expect(out).not.toContain("MISMATCH");
  });

  it("never includes a Bearer token marker in the rendered output", () => {
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 12345,
      controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
      daemonProjectDir: "/Users/op/Desktop/mono/apps/kota",
      daemonProjectName: "kota",
    }));
    expect(out).not.toContain("Bearer ");
  });

  it("renders the daemon-served dashboard URL when /identity advertises it", () => {
    const out = formatStatusOutput(
      makeSnap({
        daemonRunning: true,
        daemonPid: 12345,
        controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
        dashboard: { available: true, url: "http://127.0.0.1:8765/" },
      }),
    );
    expect(out).toContain("Dashboard");
    expect(out).toContain("available");
    expect(out).toContain("http://127.0.0.1:8765/");
  });

  it("explains why the dashboard is not available when /identity reports an unavailable capability", () => {
    const out = formatStatusOutput(
      makeSnap({
        daemonRunning: true,
        daemonPid: 12345,
        controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
        dashboard: {
          available: false,
          reason: "web_ui_not_built",
          message: "Run `pnpm --filter @kota/web build`.",
        },
      }),
    );
    expect(out).toContain("Dashboard");
    expect(out).toContain("not available");
    expect(out).toContain("web_ui_not_built");
    expect(out).toContain("Run `pnpm --filter @kota/web build`.");
    expect(out).not.toContain("localhost:3000");
  });

  it("omits the Dashboard line when the daemon never answered /identity", () => {
    const out = formatStatusOutput(
      makeSnap({
        daemonRunning: false,
        controlFile: { kind: "stale", pid: 99999, baseURL: "http://127.0.0.1:8765" },
      }),
    );
    expect(out).not.toContain("Dashboard");
  });
});

describe("resolveDashboardForStatus", () => {
  it("joins the daemon base URL with the advertised relative path", () => {
    expect(
      resolveDashboardForStatus(
        { available: true, path: "/" },
        "http://127.0.0.1:8765",
      ),
    ).toEqual({ available: true, url: "http://127.0.0.1:8765/" });
  });

  it("preserves a fully qualified path so a configured external dev URL passes through unchanged", () => {
    // The dashboard contract types `path` as a string. A daemon that
    // configures the dashboard at an external URL (e.g. the local Vite
    // dev server during web client development) emits the absolute URL
    // and the CLI surfaces it verbatim instead of stitching loopback in
    // front of `localhost:3000`.
    expect(
      resolveDashboardForStatus(
        { available: true, path: "http://localhost:3000/" },
        "http://127.0.0.1:8765",
      ),
    ).toEqual({
      available: true,
      url: "http://localhost:3000/",
    });
  });

  it("forwards the unavailable reason and message verbatim", () => {
    expect(
      resolveDashboardForStatus(
        {
          available: false,
          reason: "web_ui_not_built",
          message: "Run `pnpm --filter @kota/web build`.",
        },
        "http://127.0.0.1:8765",
      ),
    ).toEqual({
      available: false,
      reason: "web_ui_not_built",
      message: "Run `pnpm --filter @kota/web build`.",
    });
  });

  it("omits the message when the daemon does not include one", () => {
    expect(
      resolveDashboardForStatus(
        { available: false, reason: "not_contributed" },
        "http://127.0.0.1:8765",
      ),
    ).toEqual({ available: false, reason: "not_contributed" });
  });
});

/**
 * Locate the latest run directory under `.kota/runs/` so the transcript
 * artifact lands somewhere a reviewer can find. Honors `KOTA_RUN_DIR`
 * when the workflow sets it. Returns `null` when no run directory is
 * available; the test then becomes a no-op.
 */
function locateRunDir(): string | null {
  const env = process.env.KOTA_RUN_DIR;
  if (env && env.length > 0) return env;
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    const runs = join(dir, ".kota", "runs");
    if (existsSync(runs)) {
      const entries = readdirSync(runs)
        .map((name) => ({ name, full: join(runs, name) }))
        .filter((e) => statSync(e.full).isDirectory())
        .map((e) => ({ ...e, mtime: statSync(e.full).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (entries.length > 0) return entries[0]!.full;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

describe("kota status — rendered transcript", () => {
  it("writes a transcript snapshot covering connected, missing, stale, and wrong-project states", () => {
    const scenarios: Array<{ label: string; snap: StatusSnapshot }> = [
      {
        label: "1. Connected — selected project matches daemon /identity, dashboard available",
        snap: {
          daemonRunning: true,
          daemonPid: 4242,
          daemonUptimeMs: 2 * 60 * 60 * 1000 + 14 * 60 * 1000,
          activeRuns: 1,
          queuedRuns: 2,
          sessions: 1,
          pendingApprovals: 0,
          projectDir: "/Users/op/Desktop/mono/apps/kota",
          projectName: "kota",
          controlFile: { kind: "fresh", pid: 4242, baseURL: "http://127.0.0.1:8765" },
          daemonProjectDir: "/Users/op/Desktop/mono/apps/kota",
          daemonProjectName: "kota",
          dashboard: { available: true, url: "http://127.0.0.1:8765/" },
        },
      },
      {
        label: "2. No control file — selected project has no .kota/daemon-control.json",
        snap: {
          daemonRunning: false,
          activeRuns: 0,
          queuedRuns: 0,
          sessions: 0,
          pendingApprovals: 0,
          projectDir: "/Users/op/Desktop/other-project",
          projectName: "other-project",
          controlFile: { kind: "missing" },
        },
      },
      {
        label: "3. Stale control file — pid 99999 not alive",
        snap: {
          daemonRunning: false,
          activeRuns: 0,
          queuedRuns: 0,
          sessions: 0,
          pendingApprovals: 0,
          projectDir: "/Users/op/Desktop/mono/apps/kota",
          projectName: "kota",
          controlFile: { kind: "stale", pid: 99999, baseURL: "http://127.0.0.1:8765" },
        },
      },
      {
        label: "4. Wrong project — daemon /identity reports a different project",
        snap: {
          daemonRunning: true,
          daemonPid: 4242,
          daemonUptimeMs: 60_000,
          activeRuns: 0,
          queuedRuns: 0,
          sessions: 0,
          pendingApprovals: 1,
          projectDir: "/Users/op/Desktop/other-project",
          projectName: "other-project",
          controlFile: { kind: "fresh", pid: 4242, baseURL: "http://127.0.0.1:8765" },
          daemonProjectDir: "/Users/op/Desktop/mono/apps/kota",
          daemonProjectName: "kota",
          wrongProject: true,
          dashboard: { available: true, url: "http://127.0.0.1:8765/" },
        },
      },
      {
        label: "5. Dashboard not built — daemon running but the embedded web UI was never compiled",
        snap: {
          daemonRunning: true,
          daemonPid: 4242,
          daemonUptimeMs: 30_000,
          activeRuns: 0,
          queuedRuns: 0,
          sessions: 0,
          pendingApprovals: 0,
          projectDir: "/Users/op/Desktop/mono/apps/kota",
          projectName: "kota",
          controlFile: { kind: "fresh", pid: 4242, baseURL: "http://127.0.0.1:8765" },
          daemonProjectDir: "/Users/op/Desktop/mono/apps/kota",
          daemonProjectName: "kota",
          dashboard: {
            available: false,
            reason: "web_ui_not_built",
            message: "Run `pnpm --filter @kota/web build`.",
          },
        },
      },
      {
        label: "6. Dashboard configured at an external URL — daemon advertises the dev server",
        snap: {
          daemonRunning: true,
          daemonPid: 4242,
          daemonUptimeMs: 60_000,
          activeRuns: 0,
          queuedRuns: 0,
          sessions: 0,
          pendingApprovals: 0,
          projectDir: "/Users/op/Desktop/mono/apps/kota",
          projectName: "kota",
          controlFile: { kind: "fresh", pid: 4242, baseURL: "http://127.0.0.1:8765" },
          daemonProjectDir: "/Users/op/Desktop/mono/apps/kota",
          daemonProjectName: "kota",
          dashboard: {
            available: true,
            url: "http://localhost:3000/",
          },
        },
      },
    ];

    const lines: string[] = [
      "# CLI transcript: kota status across daemon-identity diagnostic states",
      "# Generated by status-cli.test.ts (deterministic, no daemon spawn).",
      "# Each block shows the rendered output of `kota status` for one scenario.",
      "# Bearer tokens are deliberately never rendered.",
      "",
    ];
    for (const { label, snap } of scenarios) {
      lines.push(`## ${label}`);
      lines.push("$ kota status");
      const rendered = formatStatusOutput(snap);
      // Sanity-pin: no Bearer leak in the rendered output.
      expect(rendered).not.toContain("Bearer ");
      lines.push(rendered);
      lines.push("");
    }
    const transcript = lines.join("\n");

    const runDir = locateRunDir();
    if (!runDir) return;
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "cli-status-transcript.txt"), transcript);
  });
});

describe("classifyDaemonControlFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kota-status-cli-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns missing when no control file exists", () => {
    expect(classifyDaemonControlFile(dir)).toEqual({ kind: "missing" });
  });

  it("returns fresh when the recorded pid is alive", () => {
    mkdirSync(join(dir, ".kota"), { recursive: true });
    writeFileSync(
      join(dir, ".kota", "daemon-control.json"),
      JSON.stringify({ port: 8765, pid: 4242, startedAt: "2026-04-29T00:00:00Z", token: "t" }),
    );
    expect(
      classifyDaemonControlFile(dir, { processIsAlive: (pid) => pid === 4242 }),
    ).toEqual({ kind: "fresh", pid: 4242, baseURL: "http://127.0.0.1:8765" });
  });

  it("returns stale when the recorded pid is not alive", () => {
    mkdirSync(join(dir, ".kota"), { recursive: true });
    writeFileSync(
      join(dir, ".kota", "daemon-control.json"),
      JSON.stringify({ port: 8765, pid: 99999, startedAt: "2026-04-29T00:00:00Z", token: "t" }),
    );
    expect(
      classifyDaemonControlFile(dir, { processIsAlive: () => false }),
    ).toEqual({ kind: "stale", pid: 99999, baseURL: "http://127.0.0.1:8765" });
  });

  it("returns unreadable when the file is not valid JSON", () => {
    mkdirSync(join(dir, ".kota"), { recursive: true });
    writeFileSync(join(dir, ".kota", "daemon-control.json"), "<not json>");
    expect(classifyDaemonControlFile(dir)).toEqual({ kind: "unreadable" });
  });

  it("returns unreadable when required fields are missing", () => {
    mkdirSync(join(dir, ".kota"), { recursive: true });
    writeFileSync(
      join(dir, ".kota", "daemon-control.json"),
      JSON.stringify({ token: "t" }),
    );
    expect(classifyDaemonControlFile(dir)).toEqual({ kind: "unreadable" });
  });
});
