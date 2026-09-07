import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyDaemonControlFile,
  formatStatusOutput,
  resolveDashboardForStatus,
  type StatusSnapshot,
} from "./status-cli.js";

function emptyRunProjection(scopeRoot: string): StatusSnapshot["runProjection"] {
  return {
    available: true,
    databasePath: join(scopeRoot, ".kota", "kota.sqlite"),
    runs: [],
  };
}

function makeSnap(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    daemonRunning: false,
    activeRuns: 0,
    queuedRuns: 0,
    workflowPaused: false,
    sessions: 0,
    pendingApprovals: 0,
    scopeRoot: "/Users/op/Desktop/mono/apps/kota",
    scopeName: "kota",
    controlFile: { kind: "missing" },
    runProjection: emptyRunProjection("/Users/op/Desktop/mono/apps/kota"),
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
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 12345,
      activeRuns: 2,
      queuedRuns: 3,
      controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
    }));
    expect(out).toContain("2 active, 3 queued");
  });

  it("shows when workflow dispatch is paused", () => {
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 12345,
      workflowPaused: true,
      queuedRuns: 3,
      controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
    }));
    expect(out).toContain("Dispatch");
    expect(out).toContain("paused");
    expect(out).toContain("kota workflow resume");
  });

  it("shows session count", () => {
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 12345,
      sessions: 1,
      controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
    }));
    expect(out).toContain("1 interactive");
  });

  it("renders durable run counts while dispatch is offline", () => {
    const out = formatStatusOutput(makeSnap({
      activeRuns: 2,
      queuedRuns: 3,
      workflowPaused: true,
    }));
    expect(out).toContain("Dispatch");
    expect(out).toContain("offline");
    expect(out).not.toContain("Dispatch  running");
    expect(out).toContain("Runs");
    expect(out).toContain("2 active, 3 queued");
    expect(out).toContain("durable database");
    expect(out).toContain("pause signal present");
  });

  it("can explain whether status came from the daemon or local offline files", () => {
    const offline = formatStatusOutput(makeSnap(), { explain: true });
    expect(offline).toContain("Runtime source");
    expect(offline).toContain("durable run database and local files");

    const running = formatStatusOutput(
      makeSnap({
        daemonRunning: true,
        daemonPid: 12345,
        controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
      }),
      { explain: true },
    );
    expect(running).toContain("Runtime source");
    expect(running).toContain("daemon control API");
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

  it("shows the scope name and directory at the top of the snapshot", () => {
    const out = formatStatusOutput(makeSnap());
    expect(out).toContain("kota");
    expect(out).toContain("/Users/op/Desktop/mono/apps/kota");
    expect(out).toContain("Scope");
  });

  it("reports a missing control file in the offline branch", () => {
    const out = formatStatusOutput(makeSnap({ controlFile: { kind: "missing" } }));
    expect(out).toContain("missing");
    expect(out).toContain("daemon-control.json");
  });

  it("flags a stranded daemon process when no control API is published", () => {
    const snap = {
      ...makeSnap({ controlFile: { kind: "missing" } }),
      strandedDaemon: {
        pid: 4242,
        command: "/opt/node /repo/dist/cli.js daemon",
      },
    } as StatusSnapshot;
    const out = formatStatusOutput(snap);
    expect(out).toContain("Stranded daemon");
    expect(out).toContain("pid 4242");
    expect(out).toContain("no control API");
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

  it("flags a wrong-scope mismatch when daemon /identity reports another scope", () => {
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 12345,
      controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
      scopeRoot: "/Users/op/Desktop/other-scope",
      scopeName: "other-scope",
      daemonScopeRoot: "/Users/op/Desktop/mono/apps/kota",
      daemonScopeName: "kota",
      wrongScope: true,
    }));
    expect(out).toContain("Daemon scope");
    expect(out).toContain("/Users/op/Desktop/mono/apps/kota");
    expect(out).toContain("MISMATCH");
  });

  it("shows the daemon's scope alongside the selected scope when they match", () => {
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 12345,
      controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
      daemonScopeRoot: "/Users/op/Desktop/mono/apps/kota",
      daemonScopeName: "kota",
    }));
    expect(out).toContain("Daemon scope");
    expect(out).not.toContain("MISMATCH");
  });

  it("shows the active scope name and path when the daemon hosts more than one scope", () => {
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 12345,
      controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
      selectedScope: {
        scopeId: "p-secondary",
        scopeRoot: "/Users/op/Desktop/secondary",
        displayName: "secondary",
      },
    }));
    expect(out).toContain("Active scope");
    expect(out).toContain("secondary");
    expect(out).toContain("/Users/op/Desktop/secondary");
  });

  it("omits the active-scope line for single-scope daemons", () => {
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 12345,
      controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
    }));
    expect(out).not.toContain("Active scope");
  });

  it("never includes a Bearer token marker in the rendered output", () => {
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 12345,
      controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
      daemonScopeRoot: "/Users/op/Desktop/mono/apps/kota",
      daemonScopeName: "kota",
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
