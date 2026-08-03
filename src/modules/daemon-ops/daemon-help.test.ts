import { describe, expect, it } from "vitest";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import daemonModule from "./index.js";

const stubCtx: ModuleRuntimeContext = {
	cwd: "/tmp/test",
	verbose: false,
	config: {} as ModuleRuntimeContext["config"],
	storage: new ModuleStorage("/tmp/test", "daemon"),
	registerGroup: () => {},
	getRoutes: () => [],
	getContributedWorkflows: () => [],
	getContributedChannels: () => [],
	getContributedUiSurfaces: () => [],
	getContributedControlRoutes: () => [],
	getModuleSummaries: () => [],
	getModuleConfig: () => undefined,
	log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
	getSecret: () => null,
	listTools: () => [],
	events: {
		emit: () => {},
		subscribe: () => () => {},
		emitExternal: () => {},
		subscribeExternal: () => () => {},
		listenerCount: () => 0,
	},
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
	client: {} as never,
};

describe("daemon command help", () => {
	it("identifies foreground daemon mode as a host dashboard", () => {
		const cmds = daemonModule.commands!(stubCtx);
		const help = cmds[0].helpInformation();
		expect(help).toContain("Run the KOTA daemon host and foreground dashboard");
		expect(help).toContain("This command hosts and monitors the daemon");
		expect(help).toMatch(/not the interactive operator\s+console/);
		expect(help).toContain("kota navigate");
		expect(help).toContain("kota workflow status");
		expect(help).toContain("kota ui render runs");
	});

	it("points daemon start operators to the console and workflow controls", () => {
		const cmds = daemonModule.commands!(stubCtx);
		const startCmd = cmds[0].commands.find((c) => c.name() === "start")!;
		const help = startCmd.helpInformation();
		expect(help).toContain("Start the KOTA daemon host and foreground dashboard");
		expect(help).toMatch(/not the interactive operator\s+console/);
		expect(help).toContain("kota navigate");
		expect(help).toContain("kota workflow status");
		expect(help).toContain("pause");
		expect(help).toContain("resume");
		expect(help).toContain("follow");
	});
});
