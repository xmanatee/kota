import { describe, expect, it, vi } from "vitest";
import type {
  McpCallToolResult,
  McpToolSchema,
} from "./client.js";
import {
  MCP_CURRENT_PROTOCOL_VERSION,
  MCP_DRAFT_PROTOCOL_VERSION,
} from "./client.js";
import type { McpInputResolver } from "./manager.js";
import { McpManager } from "./manager.js";
import {
  FakeMcpManagerClient,
  managerWithClients,
  settleManagerRefresh,
} from "./manager-test-support.js";
import { remoteMcpServerIdentity } from "./remote-task-server-identity.js";
import type {
  PersistedRemoteMcpTaskHandle,
  RemoteMcpTaskStore,
} from "./remote-task-store.js";
import { remoteMcpTaskHandleId } from "./remote-task-store.js";

const serverConfig = { command: "mcp-peer", args: ["--serve"] };

function config(...serverNames: string[]) {
  return {
    mcpServers: Object.fromEntries(serverNames.map((name) => [name, serverConfig])),
  };
}

function tool(name: string, overrides: Partial<McpToolSchema> = {}): McpToolSchema {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: "object", properties: {} },
    ...overrides,
  };
}

function complete(text: string): McpCallToolResult {
  return {
    resultType: "complete",
    protocolVersion: MCP_CURRENT_PROTOCOL_VERSION,
    content: [{ type: "text", text }],
    text,
    blocks: [{ type: "text", text }],
  };
}

class CapturingRemoteTaskStore implements RemoteMcpTaskStore {
  readonly upserts: PersistedRemoteMcpTaskHandle[] = [];
  readonly removals: string[] = [];

  constructor(readonly handles: PersistedRemoteMcpTaskHandle[] = []) {}

  async list(): Promise<PersistedRemoteMcpTaskHandle[]> {
    return this.handles.map((handle) => ({ ...handle }));
  }

  async upsert(handle: PersistedRemoteMcpTaskHandle): Promise<void> {
    this.upserts.push({ ...handle });
  }

  async remove(id: string): Promise<void> {
    this.removals.push(id);
  }
}

describe("McpManager lifecycle and composition", () => {
  it("stays empty, rejects unknown routes, and closes idempotently", async () => {
    const manager = new McpManager();

    expect(manager.getServerCount()).toBe(0);
    expect(manager.getTools()).toEqual([]);
    expect(manager.isMcpTool("shell")).toBe(false);
    await expect(manager.executeTool("mcp__missing__tool", {})).resolves.toEqual({
      content: "Unknown MCP tool: mcp__missing__tool",
      is_error: true,
    });
    await manager.initialize({ mcpServers: {} });
    await manager.close();
    await manager.close();
  });

  it("normalizes config and supplies only manager-selected client options to the port", async () => {
    const remote = new FakeMcpManagerClient("Remote display");
    const authorizationResolver = vi.fn();
    const { manager, factoryCalls } = managerWithClients({ remote });

    await manager.initialize(config("remote"), {
      inputResolverAvailable: true,
      remoteTaskConsumptionAvailable: false,
      authorizationResolver,
    });

    expect(factoryCalls).toEqual([{
      serverName: "remote",
      transport: { type: "stdio", command: "mcp-peer", args: ["--serve"] },
      options: {
        supportedElicitationModes: ["form", "url"],
        enableRemoteTasks: false,
        authorizationResolver,
      },
    }]);
    await manager.close();
  });

  it("keeps successful servers when another connection fails", async () => {
    const good = new FakeMcpManagerClient("good");
    good.tools = [tool("search")];
    const bad = new FakeMcpManagerClient("bad");
    bad.connectError = new Error("unavailable");
    const { manager } = managerWithClients({ good, bad });

    await manager.initialize(config("good", "bad"));

    expect(manager.getServerCount()).toBe(1);
    expect(manager.getTools().map((entry) => entry.name)).toEqual(["mcp__good__search"]);
    expect(bad.closeCount).toBe(1);
    await manager.close();
  });

  it("rejects malformed server selection before constructing a client", async () => {
    const { manager, factoryCalls } = managerWithClients({});

    await manager.initialize({
      mcpServers: {
        "bad__name": serverConfig,
        ambiguous: { command: "peer", url: "https://example.test/mcp" } as never,
      },
    });

    expect(factoryCalls).toEqual([]);
    expect(manager.getServerCount()).toBe(0);
  });
});

describe("McpManager registry and routing", () => {
  it("composes namespaced tools from multiple servers and binds calls to their selected clients", async () => {
    const alpha = new FakeMcpManagerClient("Alpha");
    alpha.tools = [tool("lookup", { annotations: { readOnlyHint: true } })];
    alpha.callToolImpl = async () => complete("alpha result");
    const beta = new FakeMcpManagerClient("Beta");
    beta.tools = [tool("lookup")];
    beta.callToolImpl = async () => complete("beta result");
    const { manager } = managerWithClients({ alpha, beta });

    await manager.initialize(config("alpha", "beta"));

    expect(manager.getTools().map((entry) => entry.name)).toEqual([
      "mcp__alpha__lookup",
      "mcp__beta__lookup",
    ]);
    expect(manager.isToolReadOnly("mcp__alpha__lookup")).toBe(true);
    expect((await manager.executeTool("mcp__alpha__lookup", { q: "one" })).content)
      .toBe("alpha result");
    expect((await manager.executeTool("mcp__beta__lookup", { q: "two" })).content)
      .toBe("beta result");
    expect(alpha.callToolCalls[0]?.slice(0, 2)).toEqual(["lookup", { q: "one" }]);
    expect(beta.callToolCalls[0]?.slice(0, 2)).toEqual(["lookup", { q: "two" }]);
    await manager.close();
  });

  it("publishes provenance and enforces declaration-bound execution", async () => {
    const remote = new FakeMcpManagerClient("Remote", { tools: true, resources: true });
    remote.tools = [tool("lookup")];
    const { manager } = managerWithClients({ remote });
    await manager.initialize(config("remote"));
    const fingerprint = manager.getToolDeclarationFingerprint("mcp__remote__lookup");

    expect(manager.getToolResultContentProvenance("mcp__remote__lookup")).toEqual({
      kind: "external-mcp",
      serverName: "remote",
      source: "tool",
      name: "lookup",
      declarationFingerprint: fingerprint,
    });
    expect(manager.getToolResultContentProvenance("mcp_resources__remote__read"))
      .toMatchObject({ source: "operation", name: "resources/read" });
    await expect(manager.executeToolWithDeclarationFingerprint(
      "mcp__remote__lookup",
      {},
      fingerprint!,
    )).resolves.toMatchObject({ ok: true });
    await expect(manager.executeToolWithDeclarationFingerprint(
      "mcp__remote__lookup",
      {},
      "stale",
    )).resolves.toEqual({ ok: false, reason: "declaration_mismatch" });
    await manager.close();
  });

  it("reports disconnected routes without invoking the client", async () => {
    const remote = new FakeMcpManagerClient("Remote");
    remote.tools = [tool("lookup")];
    const { manager } = managerWithClients({ remote });
    await manager.initialize(config("remote"));
    remote.connected = false;

    await expect(manager.executeTool("mcp__remote__lookup", {})).resolves.toEqual({
      content: "MCP server disconnected for tool: mcp__remote__lookup",
      is_error: true,
    });
    expect(remote.callToolCalls).toEqual([]);
    await manager.close();
  });

  it("refreshes only the notifying server and preserves its last-known-good registry on failure", async () => {
    const dynamic = new FakeMcpManagerClient("Dynamic");
    dynamic.tools = [tool("before")];
    const stable = new FakeMcpManagerClient("Stable");
    stable.tools = [tool("always")];
    const { manager } = managerWithClients({ dynamic, stable });
    await manager.initialize(config("dynamic", "stable"));

    dynamic.tools = [tool("after")];
    dynamic.emitToolListChanged();
    await settleManagerRefresh();
    expect(manager.getTools().map((entry) => entry.name)).toEqual([
      "mcp__dynamic__after",
      "mcp__stable__always",
    ]);
    expect(stable.listToolsCalls).toBe(1);

    dynamic.listToolsImpl = async () => { throw new Error("refresh rejected"); };
    dynamic.emitToolListChanged();
    await settleManagerRefresh();
    expect(manager.getTools().map((entry) => entry.name)).toEqual([
      "mcp__dynamic__after",
      "mcp__stable__always",
    ]);
    await manager.close();
  });

  it("records declaration drift independently from routing availability", async () => {
    const remote = new FakeMcpManagerClient("Remote");
    remote.tools = [tool("lookup", { description: "before" })];
    const { manager } = managerWithClients({ remote });
    await manager.initialize(config("remote"));
    const before = manager.getToolDeclarationFingerprint("mcp__remote__lookup");

    remote.tools = [tool("lookup", { description: "after" })];
    remote.emitToolListChanged();
    await settleManagerRefresh();

    const after = manager.getToolDeclarationFingerprint("mcp__remote__lookup");
    expect(after).not.toBe(before);
    expect(manager.getToolDeclarationDriftDiagnostics()).toEqual([{
      serverConfigName: "remote",
      serverDisplayName: "Remote",
      toolName: "lookup",
      previousFingerprint: before,
      currentFingerprint: after,
      changedFacets: ["description"],
    }]);
    await manager.close();
  });
});

describe("McpManager operation composition and caches", () => {
  it("exposes only capability-backed operations and caches complete client catalogs", async () => {
    const remote = new FakeMcpManagerClient("Remote", {
      tools: false,
      resources: true,
      prompts: true,
    });
    remote.listResourcesImpl = async () => ({
      resources: [{ uri: "file:///one", name: "one" }],
      cache: { ttlMs: 60_000, cacheScope: "public" },
    });
    remote.listPromptsImpl = async () => ({
      prompts: [{ name: "review" }],
      cache: { ttlMs: 60_000, cacheScope: "private" },
    });
    const { manager } = managerWithClients({ remote });
    await manager.initialize(config("remote"));

    const names = manager.getTools().map((entry) => entry.name);
    expect(names).toContain("mcp_resources__remote__list");
    expect(names).toContain("mcp_prompts__remote__list");
    expect(names).not.toContain("mcp__remote__lookup");
    await manager.executeTool("mcp_resources__remote__list", {});
    const cached = await manager.executeTool("mcp_resources__remote__list", {});
    await manager.executeTool("mcp_prompts__remote__list", {});
    await manager.executeTool("mcp_prompts__remote__list", {});

    expect(remote.listResourcesCalls).toBe(1);
    expect(remote.listPromptsCalls).toBe(1);
    expect(cached._meta).toMatchObject({ mcp: { cache: [{ source: "cache", reason: "fresh" }] } });
    await manager.close();
  });

  it("invalidates only matching resource, skill, and prompt caches from port events", async () => {
    const remote = new FakeMcpManagerClient("Remote", {
      tools: false,
      resources: true,
      prompts: true,
    });
    remote.listResourcesImpl = async () => ({ resources: [], cache: { ttlMs: 60_000, cacheScope: "public" } });
    remote.listPromptsImpl = async () => ({ prompts: [], cache: { ttlMs: 60_000, cacheScope: "public" } });
    remote.listRemoteSkillsImpl = async () => ({
      status: "enumerated",
      indexUri: "skill://index.json",
      enumerationExhaustive: false,
      advertised: true,
      skills: [],
      cache: { ttlMs: 60_000, cacheScope: "public" },
    });
    const { manager } = managerWithClients({ remote });
    await manager.initialize(config("remote"));
    await manager.executeTool("mcp_resources__remote__list", {});
    await manager.executeTool("mcp_prompts__remote__list", {});
    await manager.executeTool("mcp_skills__remote__list", {});

    remote.emitResourceListChanged();
    await manager.executeTool("mcp_resources__remote__list", {});
    await manager.executeTool("mcp_skills__remote__list", {});
    await manager.executeTool("mcp_prompts__remote__list", {});
    expect(remote.listResourcesCalls).toBe(2);
    expect(remote.listPromptsCalls).toBe(1);

    remote.emitPromptListChanged();
    await manager.executeTool("mcp_prompts__remote__list", {});
    expect(remote.listPromptsCalls).toBe(2);
    await manager.close();
  });
});

describe("McpManager execution coordination", () => {
  it("routes progress and additional input without changing the selected tool", async () => {
    const remote = new FakeMcpManagerClient("Remote");
    remote.tools = [tool("deploy")];
    let attempt = 0;
    remote.callToolImpl = async (_name, _input, retry, options) => {
      options?.progress?.onProgress({
        requestId: 1,
        progressToken: "p1",
        progress: 0.5,
        sequence: 1,
      });
      attempt += 1;
      return attempt === 1
        ? {
            resultType: "input_required",
            protocolVersion: MCP_CURRENT_PROTOCOL_VERSION,
            inputRequests: { confirm: { method: "elicitation/create", params: {} } },
            requestState: "pending",
          }
        : complete(`retried:${retry?.requestState}`);
    };
    const { manager } = managerWithClients({ remote });
    await manager.initialize(config("remote"));
    const progress = vi.fn();
    const resolveInput = vi.fn(async () => ({
      kind: "respond" as const,
      inputResponses: { confirm: { action: "accept" as const, content: {} } },
    }));
    const inputResolver: McpInputResolver = resolveInput;

    const result = await manager.executeTool("mcp__remote__deploy", {}, {
      progressResolver: progress,
      inputResolver,
    });

    expect(result.content).toBe("retried:pending");
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      server: "Remote",
      tool: "deploy",
      progress: 0.5,
    }));
    expect(resolveInput).toHaveBeenCalledWith(expect.objectContaining({
      server: "Remote",
      tool: "deploy",
      requestState: "pending",
    }));
    await manager.close();
  });

  it("persists, updates, polls, and clears a remote task through the client port", async () => {
    const store = new CapturingRemoteTaskStore();
    const remote = new FakeMcpManagerClient("Remote", { tools: true, tasks: true });
    remote.tools = [tool("deploy")];
    remote.callToolImpl = async () => ({
      resultType: "task",
      protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
      taskId: "task-1",
      status: "input_required",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUpdatedAt: "2026-01-01T00:00:00.000Z",
      ttlMs: null,
      inputRequests: { confirm: { method: "elicitation/create", params: {} } },
      requestState: "pending",
    });
    const { manager } = managerWithClients({ remote }, { remoteTaskStore: store });
    await manager.initialize(config("remote"), { remoteTaskConsumptionAvailable: true });

    const result = await manager.executeTool("mcp__remote__deploy", {}, {
      inputResolver: async () => ({
        kind: "respond",
        inputResponses: { confirm: { action: "accept", content: {} } },
      }),
    });

    expect(result.content).toBe("done");
    expect(remote.updateTaskCalls).toHaveLength(1);
    expect(remote.getTaskCalls).toEqual(["task-1"]);
    expect(store.upserts[0]).toMatchObject({
      taskId: "task-1",
      toolName: "deploy",
      toolDeclarationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(store.removals).toEqual([remoteMcpTaskHandleId("remote", "task-1")]);
    await manager.close();
  });

  it("resumes a matching persisted task through the client port", async () => {
    const identity = remoteMcpServerIdentity({
      type: "stdio",
      command: "mcp-peer",
      args: ["--serve"],
      env: {},
    });
    const handle: PersistedRemoteMcpTaskHandle = {
      id: remoteMcpTaskHandleId("remote", "task-resume"),
      serverConfigName: "remote",
      serverDisplayName: "Remote",
      serverFingerprint: identity.fingerprint,
      serverMatch: identity.match,
      toolName: "deploy",
      taskId: "task-resume",
      protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
      status: "working",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUpdatedAt: "2026-01-01T00:00:00.000Z",
      ttlMs: null,
      pollCount: 2,
      inputUpdateCount: 0,
      startedAt: "2026-01-01T00:00:00.000Z",
      deadlineAt: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const store = new CapturingRemoteTaskStore([handle]);
    const remote = new FakeMcpManagerClient("Remote", { tools: true, tasks: true });
    remote.tools = [tool("deploy")];
    const { manager } = managerWithClients({ remote }, { remoteTaskStore: store });

    await manager.initialize(config("remote"), { remoteTaskConsumptionAvailable: true });

    expect(remote.getTaskCalls).toEqual(["task-resume"]);
    expect(manager.getRemoteTaskResumeResults()).toEqual([
      expect.objectContaining({
        kind: "result",
        taskId: "task-resume",
        result: expect.objectContaining({ content: "done" }),
      }),
    ]);
    expect(store.removals).toEqual([remoteMcpTaskHandleId("remote", "task-resume")]);
    await manager.close();
  });

  it("keeps unmatched persisted tasks as explicit resume diagnostics", async () => {
    const identity = remoteMcpServerIdentity({ type: "stdio", command: "mcp-peer", args: ["--serve"], env: {} });
    const handle: PersistedRemoteMcpTaskHandle = {
      id: remoteMcpTaskHandleId("remote", "task-stale"),
      serverConfigName: "remote",
      serverDisplayName: "Remote",
      serverFingerprint: identity.fingerprint,
      serverMatch: identity.match,
      toolName: "removed",
      toolDeclarationFingerprint: "0".repeat(64),
      taskId: "task-stale",
      protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
      status: "working",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUpdatedAt: "2026-01-01T00:00:00.000Z",
      ttlMs: null,
      pollCount: 0,
      inputUpdateCount: 0,
      startedAt: "2026-01-01T00:00:00.000Z",
      deadlineAt: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const store = new CapturingRemoteTaskStore([handle]);
    const remote = new FakeMcpManagerClient("Remote", { tools: true, tasks: true });
    remote.tools = [];
    const { manager } = managerWithClients({ remote }, { remoteTaskStore: store });

    await manager.initialize(config("remote"), { remoteTaskConsumptionAvailable: true });

    expect(manager.getRemoteTaskResumeResults()).toEqual([
      expect.objectContaining({ kind: "diagnostic", taskId: "task-stale" }),
    ]);
    expect(remote.getTaskCalls).toEqual([]);
    expect(store.upserts.at(-1)?.lastDiagnostic).toContain("current tool declaration is missing");
    await manager.close();
  });
});
