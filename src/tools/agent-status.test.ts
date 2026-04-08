import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initProviderRegistry, resetProviderRegistry } from "../providers.js";
import { enableGroup, resetGroups } from "../tool-groups.js";
import {
	resetAgentStatusProviders,
	runAgentStatus,
	setConfigProvider,
	setExtensionInfoProvider,
} from "./agent-status.js";

describe("agent_status", () => {
	beforeEach(() => {
		resetAgentStatusProviders();
		resetGroups();
		resetProviderRegistry();
	});

	afterEach(() => {
		resetAgentStatusProviders();
		resetGroups();
		resetProviderRegistry();
	});

	describe("tools query", () => {
		it("lists core tools", async () => {
			const result = await runAgentStatus({ query: "tools" });
			expect(result.content).toContain("## Tools");
			expect(result.content).toContain("Core tools");
			// shell is now in the execution extension, not in core
			expect(result.content).not.toContain("shell");
			// file_read is now in the filesystem extension, not in core
			expect(result.content).not.toContain("file_read");
			expect(result.content).toContain("delegate");
		});

		it("shows risk level for non-safe tools", async () => {
			const result = await runAgentStatus({ query: "tools" });
			expect(result.content).toContain("(moderate)");
		});

		it("shows tool group", async () => {
			const result = await runAgentStatus({ query: "tools" });
			expect(result.content).toContain("[core]");
			// management group tools (todo, notify, confirm, approval, audit, prompt_template) are in core
			expect(result.content).toContain("[management]");
		});

		it("filters tools by name", async () => {
			// grep, shell, and git are now in extensions; use a core tool like "delegate"
			const result = await runAgentStatus({ query: "tools", filter: "delegate" });
			expect(result.content).toContain("delegate");
			expect(result.content).not.toContain("ask_user");
		});

		it("filters tools by description", async () => {
			// file_read and shell are now in extensions; filter by "delegate" instead
			const result = await runAgentStatus({ query: "tools", filter: "delegate" });
			expect(result.content).toContain("## Tools");
			expect(result.content).toContain("delegate");
		});

		it("shows no match message when filter matches nothing", async () => {
			const result = await runAgentStatus({ query: "tools", filter: "zzz_nonexistent_zzz" });
			expect(result.content).toContain("no tools match filter");
		});
	});

	describe("extensions query", () => {
		it("shows message when no provider set", async () => {
			const result = await runAgentStatus({ query: "extensions" });
			expect(result.content).toContain("extension info not available");
		});

		it("lists loaded extensions when provider is set", async () => {
			setExtensionInfoProvider(() => [
				{ name: "memory", toolCount: 2 },
				{ name: "scheduler", toolCount: 1 },
				{ name: "history", toolCount: 0 },
			]);
			const result = await runAgentStatus({ query: "extensions" });
			expect(result.content).toContain("3 extension(s) loaded");
			expect(result.content).toContain("memory (2 tools)");
			expect(result.content).toContain("scheduler (1 tools)");
			expect(result.content).toContain("- history");
			expect(result.content).not.toContain("history (0 tools)");
		});

		it("filters extensions by name", async () => {
			setExtensionInfoProvider(() => [
				{ name: "memory", toolCount: 2 },
				{ name: "scheduler", toolCount: 1 },
			]);
			const result = await runAgentStatus({ query: "extensions", filter: "mem" });
			expect(result.content).toContain("memory");
			expect(result.content).not.toContain("scheduler");
		});

		it("shows empty message when no extensions loaded", async () => {
			setExtensionInfoProvider(() => []);
			const result = await runAgentStatus({ query: "extensions" });
			expect(result.content).toContain("no extensions loaded");
		});
	});

	describe("providers query", () => {
		it("shows message when registry not initialized", async () => {
			const result = await runAgentStatus({ query: "providers" });
			expect(result.content).toContain("provider registry not initialized");
		});

		it("lists registered providers with active indicator", async () => {
			const reg = initProviderRegistry();
			reg.register("memory", "default", {});
			reg.register("memory", "redis", {});
			reg.register("knowledge", "default", {});

			const result = await runAgentStatus({ query: "providers" });
			expect(result.content).toContain("## Providers");
			expect(result.content).toContain("memory:");
			expect(result.content).toContain("**default** (active)");
			expect(result.content).toContain("redis");
			expect(result.content).toContain("knowledge:");
		});

		it("filters providers by type", async () => {
			const reg = initProviderRegistry();
			reg.register("memory", "default", {});
			reg.register("knowledge", "default", {});

			const result = await runAgentStatus({ query: "providers", filter: "know" });
			expect(result.content).toContain("knowledge");
			expect(result.content).not.toContain("memory");
		});

		it("shows empty message when no providers registered", async () => {
			initProviderRegistry();
			const result = await runAgentStatus({ query: "providers" });
			expect(result.content).toContain("no providers registered");
		});
	});

	describe("groups query", () => {
		it("lists all tool groups with status", async () => {
			const result = await runAgentStatus({ query: "groups" });
			expect(result.content).toContain("## Tool Groups");
			expect(result.content).toContain("web");
			expect(result.content).toContain("[disabled]");
		});

		it("shows enabled status after enabling a group", async () => {
			enableGroup("web");
			const result = await runAgentStatus({ query: "groups" });
			expect(result.content).toContain("web [enabled]");
			expect(result.content).toContain("code [disabled]");
		});

		it("lists tools in each group", async () => {
			const result = await runAgentStatus({ query: "groups" });
			expect(result.content).toContain("web_search");
			expect(result.content).toContain("code_exec");
		});

		it("filters groups by name", async () => {
			const result = await runAgentStatus({ query: "groups", filter: "gui" });
			expect(result.content).toContain("gui");
			expect(result.content).not.toContain("- web");
		});
	});

	describe("config query", () => {
		it("shows message when no config provider", async () => {
			const result = await runAgentStatus({ query: "config" });
			expect(result.content).toContain("config not available");
		});

		it("shows config entries", async () => {
			setConfigProvider(() => ({
				model: "claude-sonnet-4-6",
				architect: true,
				verbose: false,
			}));
			const result = await runAgentStatus({ query: "config" });
			expect(result.content).toContain("## Config");
			expect(result.content).toContain("model");
			expect(result.content).toContain("claude-sonnet-4-6");
			expect(result.content).toContain("architect");
		});

		it("redacts modelProvider apiKey", async () => {
			setConfigProvider(() => ({
				modelProvider: { type: "openai", baseUrl: "https://api.openai.com", apiKey: "sk-secret" },
			}));
			const result = await runAgentStatus({ query: "config" });
			expect(result.content).toContain("openai");
			expect(result.content).toContain("baseUrl");
			expect(result.content).not.toContain("sk-secret");
		});

		it("filters config by key name", async () => {
			setConfigProvider(() => ({
				model: "claude-sonnet-4-6",
				verbose: true,
			}));
			const result = await runAgentStatus({ query: "config", filter: "model" });
			expect(result.content).toContain("model");
			expect(result.content).not.toContain("verbose");
		});
	});

	describe("all query", () => {
		it("includes all sections", async () => {
			setExtensionInfoProvider(() => [{ name: "test-mod", toolCount: 1 }]);
			setConfigProvider(() => ({ model: "test" }));
			initProviderRegistry();

			const result = await runAgentStatus({ query: "all" });
			expect(result.content).toContain("## Tools");
			expect(result.content).toContain("## Extensions");
			expect(result.content).toContain("## Providers");
			expect(result.content).toContain("## Tool Groups");
			expect(result.content).toContain("## Config");
		});

		it("defaults to 'all' when query is missing", async () => {
			const result = await runAgentStatus({});
			expect(result.content).toContain("## Tools");
			expect(result.content).toContain("## Tool Groups");
		});
	});

	describe("registration", () => {
		it("tool has correct name and description", async () => {
			const { agentStatusTool } = await import("./agent-status.js");
			expect(agentStatusTool.name).toBe("agent_status");
			expect(agentStatusTool.description).toContain("Introspect");
		});

		it("registration is safe risk with no group (core)", async () => {
			const { registration } = await import("./agent-status.js");
			expect(registration.risk).toBe("safe");
			expect(registration.group).toBeUndefined();
		});
	});

	describe("resetAgentStatusProviders", () => {
		it("clears extension and config providers", async () => {
			setExtensionInfoProvider(() => [{ name: "test", toolCount: 0 }]);
			setConfigProvider(() => ({ model: "test" }));
			resetAgentStatusProviders();

			const extensions = await runAgentStatus({ query: "extensions" });
			expect(extensions.content).toContain("extension info not available");

			const config = await runAgentStatus({ query: "config" });
			expect(config.content).toContain("config not available");
		});
	});
});
