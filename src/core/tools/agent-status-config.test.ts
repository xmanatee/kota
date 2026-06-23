import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAgentStatusProviders, runAgentStatus, setConfigProvider } from "./agent-status.js";

describe("agent_status config query", () => {
	beforeEach(() => {
		resetAgentStatusProviders();
	});

	afterEach(() => {
		resetAgentStatusProviders();
	});

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

	it("redacts nested module, webhook, MCP authorization, and token-shaped config values", async () => {
		setConfigProvider(() => ({
			modules: {
				linear: {
					apiKey: "lin-secret",
					teamKey: "OPS",
				},
				"google-workspace": {
					oauth: {
						clientSecret: "google-client-secret",
						refreshToken: "google-refresh-token",
					},
				},
			},
			webhooks: {
				github: {
					secret: "github-webhook-secret",
					path: "/webhooks/github",
				},
			},
			mcp: {
				servers: {
					files: {
						authorization: "Bearer mcp-auth-secret",
						headers: [{ Authorization: "Bearer mcp-header-secret" }],
					},
				},
			},
			nested: {
				credential: "nested-credential-secret",
				cookieJar: "nested-cookie-secret",
				plain: "visible-value",
			},
		}));

		const result = await runAgentStatus({ query: "config" });

		expect(result.content).toContain("OPS");
		expect(result.content).toContain("/webhooks/github");
		expect(result.content).toContain("visible-value");
		expect(result.content).not.toContain("lin-secret");
		expect(result.content).not.toContain("google-client-secret");
		expect(result.content).not.toContain("google-refresh-token");
		expect(result.content).not.toContain("github-webhook-secret");
		expect(result.content).not.toContain("Bearer mcp-auth-secret");
		expect(result.content).not.toContain("Bearer mcp-header-secret");
		expect(result.content).not.toContain("nested-credential-secret");
		expect(result.content).not.toContain("nested-cookie-secret");
		expect(result.content).toContain('"apiKey":"***"');
		expect(result.content).toContain('"secret":"***"');
		expect(result.content).toContain('"authorization":"***"');
		expect(result.content).toContain('"Authorization":"***"');
		expect(result.content).toContain('"credential":"***"');
		expect(result.content).toContain('"cookieJar":"***"');
	});

	it("redacts private-key-shaped config values", async () => {
		setConfigProvider(() => ({
			modules: {
				demo: {
					privateKeyPem: "-----BEGIN PRIVATE KEY-----",
					private_key: "private-key-material",
					signingKey: "signing-key-material",
					clientAssertion: "signed-client-assertion",
					teamKey: "OPS",
				},
			},
		}));

		const result = await runAgentStatus({ query: "config" });

		expect(result.content).toContain("OPS");
		expect(result.content).not.toContain("-----BEGIN PRIVATE KEY-----");
		expect(result.content).not.toContain("private-key-material");
		expect(result.content).not.toContain("signing-key-material");
		expect(result.content).not.toContain("signed-client-assertion");
		expect(result.content).toContain('"privateKeyPem":"***"');
		expect(result.content).toContain('"private_key":"***"');
		expect(result.content).toContain('"signingKey":"***"');
		expect(result.content).toContain('"clientAssertion":"***"');
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
