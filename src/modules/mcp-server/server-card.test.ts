import { describe, expect, it } from "vitest";
import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type { McpRegistryMetadata } from "./registry-metadata.js";
import {
	buildMcpServerCard,
	MCP_SERVER_CARD_SCHEMA_URL,
} from "./server-card.js";

type ServerJsonOverrides = Partial<McpRegistryMetadata["serverJson"]> & {
	_meta?: KotaJsonObject;
};

function metadata(overrides: ServerJsonOverrides = {}): McpRegistryMetadata {
	const serverJson: McpRegistryMetadata["serverJson"] & { _meta?: KotaJsonObject } = {
		$schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
		name: "io.github.xmanatee/kota",
		title: "KOTA",
		description: "Keep Only The Awesome. An AI coding agent MCP server exposing KOTA tools.",
		repository: {
			source: "github",
			url: "https://github.com/xmanatee/kota",
		},
		version: "0.1.0",
		packages: [
			{
				registryType: "npm",
				identifier: "kota",
				version: "0.1.0",
				transport: { type: "stdio" },
				packageArguments: [{ type: "positional", value: "mcp-server" }],
			},
		],
		...overrides,
	};
	return {
		packageJson: {
			name: "kota",
			version: "0.1.0",
			mcpName: "io.github.xmanatee/kota",
		},
		serverJson,
	};
}

describe("MCP Server Card projection", () => {
	it("emits the experimental extension Server Card shape without old draft fields", () => {
		const card = buildMcpServerCard({
			metadata: metadata(),
		});

		expect(card).toEqual({
			$schema: MCP_SERVER_CARD_SCHEMA_URL,
			name: "io.github.xmanatee/kota",
			title: "KOTA",
			description: "Keep Only The Awesome. An AI coding agent MCP server exposing KOTA tools.",
			repository: {
				source: "github",
				url: "https://github.com/xmanatee/kota",
			},
			version: "0.1.0",
		});
		expect(card.serverInfo).toBeUndefined();
		expect(card.protocolVersion).toBeUndefined();
		expect(card.transport).toBeUndefined();
		expect(card.capabilities).toBeUndefined();
		expect(card.packages).toBeUndefined();
		expect(card.tools).toBeUndefined();
		expect(card.resources).toBeUndefined();
		expect(card.prompts).toBeUndefined();
		expect(card.remotes).toBeUndefined();
	});

	it("uses public registry remotes when server.json declares them", () => {
		const card = buildMcpServerCard({
			metadata: metadata({
				remotes: [{ type: "streamable-http", url: "https://mcp.example.test/mcp" }],
			}),
		});

		expect(card.remotes).toEqual([
			{ type: "streamable-http", url: "https://mcp.example.test/mcp" },
		]);
	});

	it("carries public extension metadata and rejects publication-sensitive metadata", () => {
		const card = buildMcpServerCard({
			metadata: metadata({
				_meta: {
					"io.github.xmanatee/kota": {
						publication: "first-party",
					},
				},
			}),
		});

		expect(card._meta).toEqual({
			"io.github.xmanatee/kota": {
				publication: "first-party",
			},
		});
		expect(() =>
			buildMcpServerCard({
				metadata: metadata({
					_meta: {
						"io.github.xmanatee/kota": {
							operatorHome: "/Users/xmanatee/Desktop/mono/apps/kota",
						},
					},
				}),
			}),
		).toThrow(/non-public metadata/);
	});

	it("rejects publication-sensitive metadata identifiers", () => {
		const sensitiveMetaCases: KotaJsonObject[] = [
			{ "io.github.xmanatee/kota": { sessionId: "session-1" } },
			{ "io.github.xmanatee/kota": { cacheKey: "userId" } },
			{ "io.github.xmanatee/kota": { headerName: "apiKey" } },
		];

		for (const sensitiveMeta of sensitiveMetaCases) {
			expect(() =>
				buildMcpServerCard({
					metadata: metadata({
						_meta: sensitiveMeta,
					}),
				}),
			).toThrow(/non-public metadata/);
		}
	});

	it("rejects private endpoints embedded in extension metadata", () => {
		expect(() =>
			buildMcpServerCard({
				metadata: metadata({
					_meta: {
						"io.github.xmanatee/kota": {
							diagnostics: "stream at https://10.0.0.7/mcp",
						},
					},
				}),
			}),
		).toThrow(/non-public metadata/);
	});
});
