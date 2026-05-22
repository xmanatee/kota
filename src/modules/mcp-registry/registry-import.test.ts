import { describe, expect, it } from "vitest";
import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import { RegistryImportError, resolveRegistryServerConfig } from "./registry-import.js";

function registryResponse(server: KotaJsonObject, status = "active"): KotaJsonObject {
	return {
		server,
		_meta: {
			"io.modelcontextprotocol.registry/official": {
				status,
			},
		},
	};
}

describe("resolveRegistryServerConfig", () => {
	it("resolves remote Streamable HTTP metadata with required variables and headers", () => {
		const result = resolveRegistryServerConfig(
			registryResponse({
				name: "com.example/acme-analytics",
				description: "Analytics",
				version: "2.0.0",
				remotes: [
					{
						type: "streamable-http",
						url: "https://{tenant}.analytics.example.com/mcp",
						variables: {
							tenant: {
								description: "Tenant slug",
								isRequired: true,
							},
						},
						headers: [
							{
								name: "X-API-Key",
								description: "API key",
								isRequired: true,
								isSecret: true,
							},
						],
					},
				],
			}),
			{
				inputs: new Map([
					["tenant", "us-cell1"],
					["X-API-Key", "test-key"],
				]),
			},
		);

		expect(result).toEqual({
			serverKey: "acme-analytics",
			config: {
				type: "http",
				url: "https://us-cell1.analytics.example.com/mcp",
				headers: { "X-API-Key": "test-key" },
			},
		});
	});

	it("resolves npm stdio package metadata to an explicit command and arguments", () => {
		const result = resolveRegistryServerConfig(
			registryResponse({
				name: "io.github.example/filesystem",
				description: "Filesystem",
				version: "1.0.0",
				packages: [
					{
						registryType: "npm",
						identifier: "@example/filesystem-mcp",
						version: "1.2.3",
						transport: { type: "stdio" },
						packageArguments: [
							{ type: "positional", value: "/tmp/project" },
							{ type: "named", name: "--mode", value: "readonly" },
						],
					},
				],
			}),
		);

		expect(result).toEqual({
			serverKey: "filesystem",
			config: {
				command: "npx",
				args: ["-y", "@example/filesystem-mcp@1.2.3", "/tmp/project", "--mode=readonly"],
			},
		});
	});

	it("rejects deprecated or deleted registry statuses", () => {
		expect(() =>
			resolveRegistryServerConfig(
				registryResponse(
					{
						name: "com.example/old",
						description: "Old",
						version: "1.0.0",
						remotes: [{ type: "streamable-http", url: "https://old.example.com/mcp" }],
					},
					"deprecated",
				),
			),
		).toThrow(new RegistryImportError("Registry server com.example/old@1.0.0 is deprecated"));
	});

	it("rejects unsupported package types before emitting config", () => {
		expect(() =>
			resolveRegistryServerConfig(
				registryResponse({
					name: "io.github.example/python",
					description: "Python",
					version: "1.0.0",
					packages: [
						{
							registryType: "pypi",
							identifier: "python-mcp",
							version: "1.0.0",
							transport: { type: "stdio" },
						},
					],
				}),
			),
		).toThrow(
			new RegistryImportError(
				"Registry server io.github.example/python@1.0.0 has no supported install choice: package registryType pypi is unsupported; supported package registryType is npm",
			),
		);
	});

	it("rejects unsupported remote transports before emitting config", () => {
		expect(() =>
			resolveRegistryServerConfig(
				registryResponse({
					name: "io.github.example/sse-only",
					description: "SSE only",
					version: "1.0.0",
					remotes: [{ type: "sse", url: "https://sse.example.com/events" }],
				}),
			),
		).toThrow(
			new RegistryImportError(
				"Registry server io.github.example/sse-only@1.0.0 has no supported install choice: remote transport sse is unsupported; supported remote transport is streamable-http",
			),
		);
	});

	it("rejects missing required operator inputs", () => {
		expect(() =>
			resolveRegistryServerConfig(
				registryResponse({
					name: "com.example/tenant",
					description: "Tenant",
					version: "1.0.0",
					remotes: [
						{
							type: "streamable-http",
							url: "https://{tenant}.example.com/mcp",
							variables: {
								tenant: { isRequired: true },
							},
							headers: [{ name: "Authorization", isRequired: true }],
						},
					],
				}),
			),
		).toThrow(
			new RegistryImportError(
				"Registry server com.example/tenant@1.0.0 requires operator input: tenant, Authorization",
			),
		);
	});

	it("rejects ambiguous supported install choices unless the operator selects one", () => {
		const response = registryResponse({
			name: "io.github.example/email",
			description: "Email",
			version: "1.0.0",
			remotes: [{ type: "streamable-http", url: "https://email.example.com/mcp" }],
			packages: [
				{
					registryType: "npm",
					identifier: "@example/email-mcp",
					version: "1.0.0",
					transport: { type: "stdio" },
				},
			],
		});

		expect(() => resolveRegistryServerConfig(response)).toThrow(
			new RegistryImportError(
				"Registry server io.github.example/email@1.0.0 has multiple supported install choices: remote streamable-http, npm stdio; pass --install-method remote or --install-method npm",
			),
		);
		expect(resolveRegistryServerConfig(response, { installMethod: "npm" }).config).toEqual({
			command: "npx",
			args: ["-y", "@example/email-mcp@1.0.0"],
		});
	});
});
