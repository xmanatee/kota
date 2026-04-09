import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ExtensionStorage } from "../../extension-storage.js";
import type { ExtensionContext } from "../../extension-types.js";
import { getBuiltinWorkflowDefinitions } from "../../workflow/registry.js";
import daemonModule, {
  buildDaemonChildArgs,
  buildLaunchdPlist,
  buildSystemdUnit,
  getLaunchdPlistPath,
  getSystemdServicePath,
  resolveDaemonWorkflowDefinitions,
} from "./index.js";

const stubCtx: ExtensionContext = {
  cwd: "/tmp/test",
  verbose: false,
  config: {} as ExtensionContext["config"],
  storage: new ExtensionStorage("/tmp/test", "daemon"),
  registerGroup: () => {},
  getRoutes: () => [],
  getContributedWorkflows: () => [],
  getContributedChannels: () => [],
  getExtensionSummaries: () => [],
  getExtensionConfig: () => undefined,
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  getSecret: () => null,
  listTools: () => [],
  events: { emit: () => {}, subscribe: () => () => {} },
  createSession: () => ({ send: async () => "", close: () => {} }),
  registerProvider: () => {},
  getProvider: () => null,
  callTool: async () => ({ content: "" }),
  registerMiddleware: () => {},
    registerDynamicStateProvider: () => {},
};

describe("daemonModule", () => {
  it("has correct metadata", () => {
    expect(daemonModule.name).toBe("daemon");
    expect(daemonModule.version).toBe("1.0.0");
    expect(daemonModule.description).toContain("Long-running");
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
    expect(optNames).toContain("--model");
    expect(optNames).toContain("--verbose");
    expect(optNames).toContain("--idle-interval");
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

  it("has no dependencies", () => {
    expect(daemonModule.dependencies).toBeUndefined();
  });

  it("builds child daemon args from parsed options", () => {
    const args = buildDaemonChildArgs({
      model: "claude-sonnet-4-6",
      verbose: true,
      idleInterval: "5",
      pollInterval: "30",
    });

    expect(args).toContain("daemon");
    expect(args).toContain("--idle-interval");
    expect(args).toContain("5");
    expect(args).toContain("--poll-interval");
    expect(args).toContain("30");
    expect(args).toContain("--model");
    expect(args).toContain("claude-sonnet-4-6");
    expect(args).toContain("--verbose");
    expect(args).not.toContain("--log-format");
  });

  it("forwards --log-format json to child args", () => {
    const args = buildDaemonChildArgs({
      idleInterval: "5",
      pollInterval: "30",
      logFormat: "json",
    });

    expect(args).toContain("--log-format");
    expect(args).toContain("json");
  });

  it("includes built-in workflows when no extension workflows are contributed", () => {
    const workflows = resolveDaemonWorkflowDefinitions([]);

    expect(workflows.map((workflow) => workflow.name)).toEqual(
      getBuiltinWorkflowDefinitions().map((workflow) => workflow.name),
    );
  });

  it("merges contributed workflows on top of the built-in set", () => {
    const workflows = resolveDaemonWorkflowDefinitions([
      {
        name: "extension/nightly",
        definitionPath: "extensions/test",
        triggers: [{ event: "runtime.idle" }],
        steps: [{ id: "emit", type: "emit", event: "extension.done" }],
      },
    ]);

    expect(workflows.map((workflow) => workflow.name)).toContain("explorer");
    expect(workflows.map((workflow) => workflow.name)).toContain("builder");
    expect(workflows.map((workflow) => workflow.name)).toContain("improver");
    expect(workflows.map((workflow) => workflow.name)).toContain("extension/nightly");
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
