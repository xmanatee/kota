import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import daemonModule, {
  buildLaunchdPlist,
  buildSystemdUnit,
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
  getModuleSummaries: () => [],
  getModuleConfig: () => undefined,
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
    registerCleanupHook: () => {},
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
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

  it("has no dependencies", () => {
    expect(daemonModule.dependencies).toBeUndefined();
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
