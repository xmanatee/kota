import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { resolveModuleTools } from "#core/modules/module-types.js";
import googleWorkspaceModule from "./index.js";

function makeCtx(config?: Record<string, unknown>): ModuleContext {
  return {
    cwd: "/tmp/test",
    verbose: false,
    config: {} as ModuleContext["config"],
    storage: {} as ModuleContext["storage"],
    registerGroup: vi.fn(),
    getRoutes: vi.fn().mockReturnValue([]),
    getContributedWorkflows: vi.fn().mockReturnValue([]),
    getContributedChannels: vi.fn().mockReturnValue([]),
    getModuleConfig: vi.fn().mockReturnValue(config),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ModuleContext["log"],
    getSecret: vi.fn().mockReturnValue(null),
    listTools: vi.fn().mockReturnValue([]),
    events: {} as ModuleContext["events"],
    createSession: vi.fn() as unknown as ModuleContext["createSession"],
    registerProvider: vi.fn(),
    getProvider: vi.fn().mockReturnValue(null),
    callTool: vi.fn() as unknown as ModuleContext["callTool"],
    registerMiddleware: vi.fn(),
    getModuleSummaries: vi.fn().mockReturnValue([]),
    registerDynamicStateProvider: vi.fn(),
    registerCleanupHook: vi.fn(),
    resolveAgentDef: vi.fn().mockReturnValue(undefined),
    resolveSkillsPrompt: vi.fn().mockReturnValue(""),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("google-workspace module metadata", () => {
  it("has correct name and version", () => {
    expect(googleWorkspaceModule.name).toBe("google-workspace");
    expect(googleWorkspaceModule.version).toBe("1.0.0");
  });
});

describe("google-workspace module tools()", () => {
  it("returns empty array when config is missing", () => {
    const ctx = makeCtx(undefined);
    const tools = resolveModuleTools(googleWorkspaceModule, ctx);
    expect(tools).toEqual([]);
  });

  it("returns empty array when clientId is missing", () => {
    const ctx = makeCtx({ clientSecret: "s", refreshToken: "r" });
    const tools = resolveModuleTools(googleWorkspaceModule, ctx);
    expect(tools).toEqual([]);
  });

  it("returns empty array when env var references are unset", () => {
    delete process.env.UNSET_CID;
    delete process.env.UNSET_CS;
    delete process.env.UNSET_RT;
    const ctx = makeCtx({
      clientId: "$UNSET_CID",
      clientSecret: "$UNSET_CS",
      refreshToken: "$UNSET_RT",
    });
    const tools = resolveModuleTools(googleWorkspaceModule, ctx);
    expect(tools).toEqual([]);
  });

  it("returns 7 tools with valid config", () => {
    const ctx = makeCtx({
      clientId: "cid",
      clientSecret: "cs",
      refreshToken: "rt",
    });
    const tools = resolveModuleTools(googleWorkspaceModule, ctx);
    expect(tools).toHaveLength(7);

    const names = tools.map((t) => t.tool.name);
    expect(names).toEqual([
      "gmail_list_messages",
      "gmail_get_message",
      "gmail_send",
      "calendar_list_events",
      "calendar_create_event",
      "drive_list_files",
      "drive_read_file",
    ]);
  });

  it("marks dangerous tools correctly", () => {
    const ctx = makeCtx({
      clientId: "cid",
      clientSecret: "cs",
      refreshToken: "rt",
    });
    const tools = resolveModuleTools(googleWorkspaceModule, ctx);
    const dangerous = tools.filter((t) => t.risk === "dangerous").map((t) => t.tool.name);
    expect(dangerous).toEqual(["gmail_send", "calendar_create_event"]);
  });

  it("marks safe tools correctly", () => {
    const ctx = makeCtx({
      clientId: "cid",
      clientSecret: "cs",
      refreshToken: "rt",
    });
    const tools = resolveModuleTools(googleWorkspaceModule, ctx);
    const safe = tools.filter((t) => t.risk === "safe").map((t) => t.tool.name);
    expect(safe).toEqual([
      "gmail_list_messages",
      "gmail_get_message",
      "calendar_list_events",
      "drive_list_files",
      "drive_read_file",
    ]);
  });

  it("logs warning when config is missing", () => {
    const ctx = makeCtx(undefined);
    resolveModuleTools(googleWorkspaceModule, ctx);
    expect(ctx.log.warn).toHaveBeenCalled();
  });
});
