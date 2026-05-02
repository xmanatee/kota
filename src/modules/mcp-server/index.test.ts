/**
 * Smoke tests for the `mcp-server` module's command surface. The actual
 * `start` operation lives in `mcp-server-operations.test.ts`; here we
 * just verify the CLI registers the expected command and option shape.
 */

import { describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import mcpServerModule from "./index.js";

function makeStubCtx(): ModuleRuntimeContext {
	const bus = new EventBus();
	return {
		cwd: "/tmp/test",
		verbose: false,
		config: {} as ModuleRuntimeContext["config"],
		storage: new ModuleStorage("/tmp/test", "mcp-server"),
		registerGroup: () => {},
		getRoutes: () => [],
		getContributedWorkflows: () => [],
		getContributedChannels: () => [],
		getContributedControlRoutes: () => [],
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
		events: makeStubEventProxy(bus),
		createSession: vi.fn(() => ({ send: vi.fn(async () => ""), close: vi.fn() })),
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
		client: {} as never,
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
