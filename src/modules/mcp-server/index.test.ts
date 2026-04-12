import { describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import mcpServerModule from "./index.js";

const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn();

vi.mock("#core/mcp/server.js", () => ({
	McpServer: vi.fn(function (this: Record<string, unknown>) {
		this.start = mockStart;
		this.stop = mockStop;
	}),
}));

vi.mock("#core/config/config.js", () => ({
	loadConfig: vi.fn(() => ({})),
}));

const mockLoadAll = vi.fn().mockResolvedValue(undefined);
vi.mock("#core/modules/module-loader.js", () => ({
	ModuleLoader: vi.fn(function (this: Record<string, unknown>) {
		this.loadAll = mockLoadAll;
	}),
}));

vi.mock("#core/modules/project-discovery.js", () => ({
	discoverProjectModules: vi.fn(async () => []),
}));

vi.mock("#core/modules/module-discovery.js", () => ({
	discoverModules: vi.fn(async () => []),
}));

function makeStubCtx(): ModuleContext {
	const bus = new EventBus();
	return {
		cwd: "/tmp/test",
		verbose: false,
		config: {} as ModuleContext["config"],
		storage: new ModuleStorage("/tmp/test", "mcp-server"),
		registerGroup: () => {},
		getRoutes: () => [],
		getContributedWorkflows: () => [],
		getContributedChannels: () => [],
		getModuleSummaries: () => [],
		getModuleConfig: () => undefined as never,
		log: Object.assign(() => {}, {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: () => {},
		}),
		getSecret: () => null,
		listTools: () => [],
		events: {
			emit: (event, payload) => bus.emit(event, payload as never),
			subscribe: (event, handler) => bus.on(event, handler as never),
		},
		createSession: vi.fn(() => ({ send: vi.fn(async () => ""), close: vi.fn() })),
		registerProvider: () => {},
		getProvider: () => null,
		callTool: async () => ({ content: "" }),
		registerMiddleware: () => {},
		registerDynamicStateProvider: () => {},
		registerCleanupHook: () => {},
		resolveAgentDef: () => undefined,
		resolveSkillsPrompt: () => "",
		probeHealthChecks: async () => ({}),
		getRegisteredConfigKeys: () => new Set<string>(),
	};
}

describe("mcp-server module metadata", () => {
	it("has correct name and version", () => {
		expect(mcpServerModule.name).toBe("mcp-server");
		expect(mcpServerModule.version).toBe("1.0.0");
	});

	it("description mentions Model Context Protocol", () => {
		expect(mcpServerModule.description).toContain("Model Context Protocol");
	});
});

describe("mcp-server commands", () => {
	it("registers a single mcp-server command", () => {
		const ctx = makeStubCtx();
		const cmds = mcpServerModule.commands!(ctx);
		expect(cmds).toHaveLength(1);
		expect(cmds[0].name()).toBe("mcp-server");
	});

	it("accepts --tools and --name options", () => {
		const ctx = makeStubCtx();
		const cmd = mcpServerModule.commands!(ctx)[0];
		const toolsOpt = cmd.options.find((o) => o.long === "--tools");
		const nameOpt = cmd.options.find((o) => o.long === "--name");
		expect(toolsOpt).toBeDefined();
		expect(nameOpt).toBeDefined();
	});

	it("--name defaults to 'kota'", () => {
		const ctx = makeStubCtx();
		const cmd = mcpServerModule.commands!(ctx)[0];
		const nameOpt = cmd.options.find((o) => o.long === "--name");
		expect(nameOpt!.defaultValue).toBe("kota");
	});
});

describe("mcp-server command action", () => {
	it("creates McpServer with correct options and starts it", async () => {
		const { McpServer } = await import("#core/mcp/server.js");
		const MockedMcpServer = vi.mocked(McpServer);
		MockedMcpServer.mockClear();
		mockStart.mockClear();

		const ctx = makeStubCtx();
		const cmd = mcpServerModule.commands!(ctx)[0];
		await cmd.parseAsync([], { from: "user" });

		expect(MockedMcpServer).toHaveBeenCalledOnce();
		const opts = MockedMcpServer.mock.calls[0]![0]!;
		expect(opts.name).toBe("kota");
		expect(opts.toolFilter).toBeUndefined();
		expect(opts.samplingEnabled).toBe(false);
		expect(mockStart).toHaveBeenCalledOnce();
	});

	it("passes tool filter when --tools is provided", async () => {
		const { McpServer } = await import("#core/mcp/server.js");
		const MockedMcpServer = vi.mocked(McpServer);
		MockedMcpServer.mockClear();
		mockStart.mockClear();

		const ctx = makeStubCtx();
		const cmd = mcpServerModule.commands!(ctx)[0];
		await cmd.parseAsync(["--tools", "read,write,search"], { from: "user" });

		const opts = MockedMcpServer.mock.calls[0]![0]!;
		expect(opts.toolFilter).toEqual(["read", "write", "search"]);
	});

	it("passes custom name when --name is provided", async () => {
		const { McpServer } = await import("#core/mcp/server.js");
		const MockedMcpServer = vi.mocked(McpServer);
		MockedMcpServer.mockClear();
		mockStart.mockClear();

		const ctx = makeStubCtx();
		const cmd = mcpServerModule.commands!(ctx)[0];
		await cmd.parseAsync(["--name", "my-server"], { from: "user" });

		const opts = MockedMcpServer.mock.calls[0]![0]!;
		expect(opts.name).toBe("my-server");
	});

	it("enables sampling when config has mcp.sampling.enabled", async () => {
		const { loadConfig } = await import("#core/config/config.js");
		const mockedLoadConfig = vi.mocked(loadConfig);
		mockedLoadConfig.mockReturnValueOnce({ mcp: { sampling: { enabled: true } } } as never);

		vi.doMock("#core/model/model-client.js", () => ({
			createModelClient: vi.fn(() => ({ client: { fake: true } })),
		}));

		const { McpServer } = await import("#core/mcp/server.js");
		const MockedMcpServer = vi.mocked(McpServer);
		MockedMcpServer.mockClear();
		mockStart.mockClear();

		const ctx = makeStubCtx();
		const cmd = mcpServerModule.commands!(ctx)[0];
		await cmd.parseAsync([], { from: "user" });

		const opts = MockedMcpServer.mock.calls[0]![0]!;
		expect(opts.samplingEnabled).toBe(true);
		expect(opts.modelClient).toBeDefined();
	});

	it("trims whitespace from tool filter names", async () => {
		const { McpServer } = await import("#core/mcp/server.js");
		const MockedMcpServer = vi.mocked(McpServer);
		MockedMcpServer.mockClear();

		const ctx = makeStubCtx();
		const cmd = mcpServerModule.commands!(ctx)[0];
		await cmd.parseAsync(["--tools", " read , write "], { from: "user" });

		const opts = MockedMcpServer.mock.calls[0]![0]!;
		expect(opts.toolFilter).toEqual(["read", "write"]);
	});

	it("loads project and system modules before creating server", async () => {
		const { ModuleLoader } = await import("#core/modules/module-loader.js");
		const { discoverProjectModules } = await import("#core/modules/project-discovery.js");
		const { discoverModules } = await import("#core/modules/module-discovery.js");
		const MockedModuleLoader = vi.mocked(ModuleLoader);
		MockedModuleLoader.mockClear();
		mockLoadAll.mockClear();

		const ctx = makeStubCtx();
		const cmd = mcpServerModule.commands!(ctx)[0];
		await cmd.parseAsync([], { from: "user" });

		expect(discoverProjectModules).toHaveBeenCalled();
		expect(discoverModules).toHaveBeenCalled();
		expect(MockedModuleLoader).toHaveBeenCalledOnce();
		expect(mockLoadAll).toHaveBeenCalledOnce();
	});
});
