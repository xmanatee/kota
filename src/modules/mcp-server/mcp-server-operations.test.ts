/**
 * Daemon-up and daemon-down branches for the `mcpServer` namespace.
 *
 * - Daemon-up: `DaemonControlClient.mcpServer.start` returns
 *   `{ ok: false, reason: "daemon_required" }` because the daemon cannot
 *   start a stdio MCP server in another process.
 * - Daemon-down: the local handler boots the real `McpServer` (mocked here
 *   so the test stays hermetic) with the resolved options.
 */
import { describe, expect, it, vi } from "vitest";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import { localMcpServerClient } from "./mcp-server-operations.js";

const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn();
const mockStartHttp = vi.fn().mockResolvedValue({
	url: "http://127.0.0.1:0/mcp",
	close: vi.fn(),
});

vi.mock("./server.js", () => ({
  McpServer: vi.fn(function (this: Record<string, unknown>) {
    this.start = mockStart;
    this.stop = mockStop;
  }),
}));

vi.mock("./streamable-http.js", () => ({
  startMcpStreamableHttpServer: mockStartHttp,
}));

vi.mock("#core/config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

const mockLoadAll = vi.fn().mockResolvedValue(undefined);
const mockSetCwd = vi.fn();
vi.mock("#core/modules/module-loader.js", () => ({
  ModuleLoader: vi.fn(function (this: Record<string, unknown>) {
    this.loadAll = mockLoadAll;
    this.setCwd = mockSetCwd;
  }),
}));

vi.mock("#core/modules/project-discovery.js", () => ({
  discoverProjectModules: vi.fn(async () => []),
}));

vi.mock("#core/modules/module-discovery.js", () => ({
  discoverModules: vi.fn(async () => []),
}));

describe("mcp-server daemon-side handler", () => {
  it("returns daemon_required from DaemonControlClient.mcpServer.start", async () => {
    const client = DaemonControlClient.fromAddress(
      {
        port: 0,
        pid: 0,
        startedAt: new Date().toISOString(),
        token: "test",
      },
      buildMigratedNamespaceTestStubs(),
    );
    const result = await client.mcpServer.start({ name: "kota" });
    expect(result).toEqual({ ok: false, reason: "daemon_required" });
  });
});

describe("mcp-server local handler", () => {
  it("creates McpServer with the resolved name and tool filter", async () => {
    const { McpServer } = await import("./server.js");
    const MockedMcpServer = vi.mocked(McpServer);
    MockedMcpServer.mockClear();
    mockStart.mockClear();

    const result = await localMcpServerClient().start({
      name: "kota",
    });
    expect(result).toEqual({ ok: true });

    expect(MockedMcpServer).toHaveBeenCalledOnce();
    const opts = MockedMcpServer.mock.calls[0]![0]!;
    expect(opts.name).toBe("kota");
    expect(opts.toolFilter).toBeUndefined();
    expect(opts.samplingEnabled).toBe(false);
    expect(mockStart).toHaveBeenCalledOnce();
  });

  it("passes a tool filter when provided", async () => {
    const { McpServer } = await import("./server.js");
    const MockedMcpServer = vi.mocked(McpServer);
    MockedMcpServer.mockClear();
    mockStart.mockClear();

    await localMcpServerClient().start({
      name: "kota",
      toolFilter: ["read", "write", "search"],
    });

    const opts = MockedMcpServer.mock.calls[0]![0]!;
    expect(opts.toolFilter).toEqual(["read", "write", "search"]);
  });

  it("honors a custom server name", async () => {
    const { McpServer } = await import("./server.js");
    const MockedMcpServer = vi.mocked(McpServer);
    MockedMcpServer.mockClear();
    mockStart.mockClear();

    await localMcpServerClient().start({ name: "my-server" });

    const opts = MockedMcpServer.mock.calls[0]![0]!;
    expect(opts.name).toBe("my-server");
  });

  it("starts the Streamable HTTP transport and returns its endpoint", async () => {
    mockStartHttp.mockClear();
    const { McpServer } = await import("./server.js");
    const MockedMcpServer = vi.mocked(McpServer);
    MockedMcpServer.mockClear();

    const result = await localMcpServerClient().start({
      name: "kota-http",
      transport: "http",
      host: "127.0.0.1",
      port: 8181,
    });

    expect(result).toEqual({
      ok: true,
      transport: "http",
      url: "http://127.0.0.1:0/mcp",
    });
    expect(MockedMcpServer).toHaveBeenCalledOnce();
    expect(mockStartHttp).toHaveBeenCalledWith({
      server: expect.any(Object),
      host: "127.0.0.1",
      port: 8181,
      endpointPath: "/mcp",
      log: expect.any(Function),
    });
  });

  it("enables sampling when config has mcp.sampling.enabled", async () => {
    const { loadConfig } = await import("#core/config/config.js");
    vi.mocked(loadConfig).mockReturnValueOnce({
      mcp: { sampling: { enabled: true } },
    } as never);

    vi.doMock("#core/model/model-client.js", () => ({
      createModelClient: vi.fn(() => ({ client: { fake: true } })),
    }));

    const { McpServer } = await import("./server.js");
    const MockedMcpServer = vi.mocked(McpServer);
    MockedMcpServer.mockClear();
    mockStart.mockClear();

    await localMcpServerClient().start({ name: "kota" });

    const opts = MockedMcpServer.mock.calls[0]![0]!;
    expect(opts.samplingEnabled).toBe(true);
    expect(opts.modelClient).toBeDefined();
  });

  it("loads project and system modules before creating the server", async () => {
    const { ModuleLoader } = await import("#core/modules/module-loader.js");
    const { discoverProjectModules } = await import(
      "#core/modules/project-discovery.js"
    );
    const { discoverModules } = await import(
      "#core/modules/module-discovery.js"
    );
    const MockedModuleLoader = vi.mocked(ModuleLoader);
    MockedModuleLoader.mockClear();
    mockLoadAll.mockClear();

    await localMcpServerClient().start({ name: "kota" });

    expect(discoverProjectModules).toHaveBeenCalled();
    expect(discoverModules).toHaveBeenCalled();
    expect(MockedModuleLoader).toHaveBeenCalledOnce();
    expect(mockLoadAll).toHaveBeenCalledOnce();
  });
});
