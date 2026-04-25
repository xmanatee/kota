import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonLiveStatus } from "#core/daemon/daemon-control.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import daemonModule, {
  buildLaunchdPlist,
  buildSystemdUnit,
  formatDaemonStatus,
  getLaunchdPlistPath,
  getSystemdServicePath,
} from "./index.js";

const stubCtx: ModuleContext = {
  cwd: "/tmp/test",
  verbose: false,
  config: {} as ModuleContext["config"],
  storage: new ModuleStorage("/tmp/test", "daemon"),
  registerGroup: () => {},
  getRoutes: () => [],
  getContributedWorkflows: () => [],
  getContributedChannels: () => [],
  getContributedControlRoutes: () => [],
  getModuleSummaries: () => [],
  getModuleConfig: () => undefined,
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  getSecret: () => null,
  listTools: () => [],
  events: { emit: () => {}, subscribe: () => () => {}, listenerCount: () => 0 },
  createSession: () => ({ send: async () => "", close: () => {} }),
  registerProvider: () => {},
  getProvider: () => null,
  callTool: async () => ({ content: "" }),
  registerMiddleware: () => {},
    registerDynamicStateProvider: () => {},
    registerCleanupHook: () => {},
    registerPreSendHook: () => {},
    registerHarnessHook: () => {},
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
    probeHealthChecks: async () => ({}),
    getRegisteredConfigKeys: () => new Set<string>(),
  };

describe("daemonModule", () => {
  it("has correct metadata", () => {
    expect(daemonModule.name).toBe("daemon-ops");
    expect(daemonModule.version).toBe("1.0.0");
    expect(daemonModule.description).toContain("daemon runtime");
  });

  it("registers daemon, events, session, and status CLI commands", () => {
    const cmds = daemonModule.commands!(stubCtx);
    expect(cmds).toHaveLength(4);
    expect(cmds[0].name()).toBe("daemon");
    expect(cmds[1].name()).toBe("events");
    expect(cmds[2].name()).toBe("session");
    expect(cmds[3].name()).toBe("status");
  });

  it("daemon command has expected options", () => {
    const cmds = daemonModule.commands!(stubCtx);
    const cmd = cmds[0];
    const optNames = cmd.options.map((o) => o.long);
    expect(optNames).toContain("--verbose");
    expect(optNames).toContain("--poll-interval");
    expect(optNames).toContain("--log-format");
  });

  it("daemon command has install and uninstall subcommands", () => {
    const cmds = daemonModule.commands!(stubCtx);
    const cmd = cmds[0];
    const subNames = cmd.commands.map((c) => c.name());
    expect(subNames).toContain("install");
    expect(subNames).toContain("uninstall");
  });

  it("install subcommand has --dry-run option", () => {
    const cmds = daemonModule.commands!(stubCtx);
    const installCmd = cmds[0].commands.find((c) => c.name() === "install")!;
    const optNames = installCmd.options.map((o) => o.long);
    expect(optNames).toContain("--dry-run");
  });

  it("does not register tools or routes", () => {
    expect(daemonModule.tools).toBeUndefined();
    expect(daemonModule.routes).toBeUndefined();
  });

  it("depends on repo-tasks for the task queue snapshot", () => {
    expect(daemonModule.dependencies).toContain("repo-tasks");
  });

  it("depends on the rendering module for status output", () => {
    expect(daemonModule.dependencies).toContain("rendering");
  });

});

describe("getLaunchdPlistPath", () => {
  it("returns path under ~/Library/LaunchAgents", () => {
    const p = getLaunchdPlistPath();
    expect(p).toBe(join(homedir(), "Library", "LaunchAgents", "com.kota.daemon.plist"));
  });
});

describe("getSystemdServicePath", () => {
  it("returns path under ~/.config/systemd/user", () => {
    const p = getSystemdServicePath();
    expect(p).toBe(join(homedir(), ".config", "systemd", "user", "kota-daemon.service"));
  });
});

describe("buildLaunchdPlist", () => {
  it("includes KOTA_PROJECT_DIR environment key", () => {
    const content = buildLaunchdPlist("/my/project");
    expect(content).toContain("KOTA_PROJECT_DIR");
    expect(content).toContain("/my/project");
  });

  it("includes the label com.kota.daemon", () => {
    const content = buildLaunchdPlist("/my/project");
    expect(content).toContain("com.kota.daemon");
  });

  it("includes RunAtLoad and KeepAlive", () => {
    const content = buildLaunchdPlist("/my/project");
    expect(content).toContain("RunAtLoad");
    expect(content).toContain("KeepAlive");
  });

  it("references the daemon log directory", () => {
    const content = buildLaunchdPlist("/my/project");
    expect(content).toContain("/my/project/.kota/daemon.log");
    expect(content).toContain("/my/project/.kota/daemon.err");
  });
});

describe("buildSystemdUnit", () => {
  it("includes KOTA_PROJECT_DIR environment", () => {
    const content = buildSystemdUnit("/my/project");
    expect(content).toContain("KOTA_PROJECT_DIR=/my/project");
  });

  it("includes Restart=on-failure", () => {
    const content = buildSystemdUnit("/my/project");
    expect(content).toContain("Restart=on-failure");
  });

  it("sets WorkingDirectory to the project dir", () => {
    const content = buildSystemdUnit("/my/project");
    expect(content).toContain("WorkingDirectory=/my/project");
  });

  it("has [Install] section with WantedBy=default.target", () => {
    const content = buildSystemdUnit("/my/project");
    expect(content).toContain("[Install]");
    expect(content).toContain("WantedBy=default.target");
  });
});

function makeLiveStatus(overrides: Partial<DaemonLiveStatus> = {}): DaemonLiveStatus {
  return {
    pid: 12345,
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    completedRuns: 10,
    running: true,
    workflow: {
      activeRuns: [],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 10,
      paused: false,
      agentConcurrency: 1,
      codeConcurrency: 4,
      workflows: {},
    },
    sessions: [],
    ...overrides,
  };
}

describe("formatDaemonStatus", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T01:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("shows relative uptime instead of raw seconds", () => {
    const status = makeLiveStatus({ startedAt: "2026-01-01T00:00:00Z" });
    const output = formatDaemonStatus(status, false);
    expect(output).toContain("up 1h 0m");
    expect(output).not.toContain("3600s");
  });

  it("shows relative time for start instead of ISO timestamp", () => {
    const status = makeLiveStatus({ startedAt: "2026-01-01T00:00:00Z" });
    const output = formatDaemonStatus(status, false);
    expect(output).toContain("1h ago");
    expect(output).not.toContain("2026-01-01T00:00:00");
  });

  it("shows active runs with workflow name and duration", () => {
    const status = makeLiveStatus({
      workflow: {
        activeRuns: [{ runId: "2026-04-15T13-13-57-840Z-builder-i8tz5a", workflow: "builder", startedAt: "2026-01-01T00:58:00Z" }],
        pendingRuns: [],
        queueLength: 0,
        completedRuns: 0,
        paused: false,
        agentConcurrency: 1,
        codeConcurrency: 4,
        workflows: {},
      },
    });
    const output = formatDaemonStatus(status, false);
    expect(output).toContain("Active runs:");
    expect(output).toContain("builder");
    expect(output).toContain("2m 0s");
  });

  it("abbreviates run IDs in active runs", () => {
    const status = makeLiveStatus({
      workflow: {
        activeRuns: [{ runId: "2026-04-15T13-13-57-840Z-builder-i8tz5a", workflow: "builder", startedAt: "2026-01-01T00:58:00Z" }],
        pendingRuns: [],
        queueLength: 0,
        completedRuns: 0,
        paused: false,
        agentConcurrency: 1,
        codeConcurrency: 4,
        workflows: {},
      },
    });
    const output = formatDaemonStatus(status, false);
    expect(output).toContain("i8tz5a");
    expect(output).not.toContain("2026-04-15T13-13-57-840Z-builder-i8tz5a");
  });

  it("shows pending runs summarized with overflow count", () => {
    const pending = Array.from({ length: 8 }, (_, i) => ({
      workflowName: `workflow-${i}`,
      trigger: { type: "event" as const, event: "test", payload: {} },
      enqueuedAtMs: Date.now(),
      notBeforeMs: 0,
    }));
    const status = makeLiveStatus({
      workflow: {
        activeRuns: [],
        pendingRuns: pending,
        queueLength: 8,
        completedRuns: 0,
        paused: false,
        agentConcurrency: 1,
        codeConcurrency: 4,
        workflows: {},
      },
    });
    const output = formatDaemonStatus(status, false);
    expect(output).toContain("Pending runs:");
    expect(output).toContain("+3 more");
    expect(output).toContain("workflow-0");
    expect(output).not.toContain("workflow-7");
  });

  it("shows managed status", () => {
    const status = makeLiveStatus();
    expect(formatDaemonStatus(status, true)).toContain("yes (OS service installed)");
    expect(formatDaemonStatus(status, false)).toMatch(/Managed:\s+no/);
  });

  it("shows cost when available", () => {
    const status = makeLiveStatus({
      workflow: {
        activeRuns: [],
        pendingRuns: [],
        queueLength: 0,
        completedRuns: 0,
        totalCostUsd: 12.5,
        paused: false,
        agentConcurrency: 1,
        codeConcurrency: 4,
        workflows: {},
      },
    });
    const output = formatDaemonStatus(status, false);
    expect(output).toContain("$12.50");
  });

  it("shows paused status", () => {
    const status = makeLiveStatus({
      workflow: {
        activeRuns: [],
        pendingRuns: [],
        queueLength: 0,
        completedRuns: 0,
        paused: true,
        agentConcurrency: 1,
        codeConcurrency: 4,
        workflows: {},
      },
    });
    const output = formatDaemonStatus(status, false);
    expect(output).toMatch(/Paused:\s+yes/);
  });
});
