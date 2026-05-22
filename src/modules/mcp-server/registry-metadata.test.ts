import { describe, expect, it } from "vitest";
import { readMcpRegistryMetadata, validateMcpRegistryMetadata } from "./registry-metadata.js";

describe("MCP registry metadata", () => {
	it("keeps server.json aligned with package.json", () => {
		const { packageJson, serverJson } = readMcpRegistryMetadata();

		expect(validateMcpRegistryMetadata({ packageJson, serverJson })).toEqual([]);
		expect(serverJson.$schema).toBe(
			"https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
		);
		expect(serverJson.name).toBe("io.github.xmanatee/kota");
		expect(serverJson.repository).toEqual({
			source: "github",
			url: "https://github.com/xmanatee/kota",
		});
		expect(serverJson.packages).toEqual([
			{
				registryType: "npm",
				identifier: "kota",
				version: packageJson.version,
				transport: {
					type: "stdio",
				},
				packageArguments: [
					{
						type: "positional",
						value: "mcp-server",
					},
				],
			},
		]);
	});

	it("rejects package ownership and version drift with explicit errors", () => {
		const { packageJson, serverJson } = readMcpRegistryMetadata();
		const mismatchedPackageVersion = "9.9.9";
		const errors = validateMcpRegistryMetadata({
			packageJson: {
				...packageJson,
				mcpName: "io.github.xmanatee/not-kota",
				version: mismatchedPackageVersion,
			},
			serverJson: {
				...serverJson,
				packages: [
					{
						...serverJson.packages[0]!,
						identifier: "not-kota",
						packageArguments: [],
					},
				],
			},
		});

		expect(errors).toContain(
			'server.json.name "io.github.xmanatee/kota" must equal package.json.mcpName "io.github.xmanatee/not-kota"',
		);
		expect(errors).toContain(
			`server.json.version "${serverJson.version}" must equal package.json.version "${mismatchedPackageVersion}"`,
		);
		expect(errors).toContain(
			'server.json.packages[0].identifier "not-kota" must equal package.json.name "kota"',
		);
		expect(errors).toContain(
			`server.json.packages[0].version "${serverJson.packages[0]!.version}" must equal package.json.version "${mismatchedPackageVersion}"`,
		);
		expect(errors).toContain(
			'server.json.packages[0].packageArguments must equal [{"type":"positional","value":"mcp-server"}]',
		);
	});

	it("rejects localhost, private-network, and reserved registry remotes", () => {
		const { packageJson, serverJson } = readMcpRegistryMetadata();
		const errors = validateMcpRegistryMetadata({
			packageJson,
			serverJson: {
				...serverJson,
				remotes: [
					{ type: "streamable-http", url: "http://localhost:7331/mcp" },
					{ type: "streamable-http", url: "https://127.0.0.1:7331/mcp" },
					{ type: "streamable-http", url: "https://10.0.0.7/mcp" },
					{ type: "streamable-http", url: "https://kota.internal/mcp" },
					{ type: "streamable-http", url: "https://192.0.2.7/mcp" },
					{ type: "streamable-http", url: "https://198.51.100.7/mcp" },
					{ type: "streamable-http", url: "https://203.0.113.7/mcp" },
					{ type: "streamable-http", url: "https://localhost./mcp" },
					{ type: "streamable-http", url: "https://127.0.0.1./mcp" },
					{ type: "streamable-http", url: "https://10.0.0.7./mcp" },
					{ type: "streamable-http", url: "https://kota.internal./mcp" },
					{ type: "streamable-http", url: "https://kota.local./mcp" },
					{ type: "streamable-http", url: "https://service.lan./mcp" },
				],
			},
		});

		expect(errors).toContain(
			'server.json.remotes[0].url "http://localhost:7331/mcp" must be a public HTTPS endpoint',
		);
		expect(errors).toContain(
			'server.json.remotes[1].url "https://127.0.0.1:7331/mcp" must be a public HTTPS endpoint',
		);
		expect(errors).toContain(
			'server.json.remotes[2].url "https://10.0.0.7/mcp" must be a public HTTPS endpoint',
		);
		expect(errors).toContain(
			'server.json.remotes[3].url "https://kota.internal/mcp" must be a public HTTPS endpoint',
		);
		expect(errors).toContain(
			'server.json.remotes[4].url "https://192.0.2.7/mcp" must be a public HTTPS endpoint',
		);
		expect(errors).toContain(
			'server.json.remotes[5].url "https://198.51.100.7/mcp" must be a public HTTPS endpoint',
		);
		expect(errors).toContain(
			'server.json.remotes[6].url "https://203.0.113.7/mcp" must be a public HTTPS endpoint',
		);
		expect(errors).toContain(
			'server.json.remotes[7].url "https://localhost./mcp" must be a public HTTPS endpoint',
		);
		expect(errors).toContain(
			'server.json.remotes[8].url "https://127.0.0.1./mcp" must be a public HTTPS endpoint',
		);
		expect(errors).toContain(
			'server.json.remotes[9].url "https://10.0.0.7./mcp" must be a public HTTPS endpoint',
		);
		expect(errors).toContain(
			'server.json.remotes[10].url "https://kota.internal./mcp" must be a public HTTPS endpoint',
		);
		expect(errors).toContain(
			'server.json.remotes[11].url "https://kota.local./mcp" must be a public HTTPS endpoint',
		);
		expect(errors).toContain(
			'server.json.remotes[12].url "https://service.lan./mcp" must be a public HTTPS endpoint',
		);
	});

	it("rejects publication-sensitive remote URL credentials and secret-like query fields", () => {
		const { packageJson, serverJson } = readMcpRegistryMetadata();
		const errors = validateMcpRegistryMetadata({
			packageJson,
			serverJson: {
				...serverJson,
				remotes: [
					{ type: "streamable-http", url: "https://user:secret@mcp.example.test/mcp" },
					{ type: "streamable-http", url: "https://mcp.example.test/mcp?token=secret" },
					{ type: "streamable-http", url: "https://mcp.example.test/mcp?api_key=secret" },
				],
			},
		});

		expect(errors).toContain(
			'server.json.remotes[0].url "https://user:secret@mcp.example.test/mcp" must not include credentials',
		);
		expect(errors).toContain(
			'server.json.remotes[1].url "https://mcp.example.test/mcp?token=secret" must not include secret-like query parameters',
		);
		expect(errors).toContain(
			'server.json.remotes[2].url "https://mcp.example.test/mcp?api_key=secret" must not include secret-like query parameters',
		);
	});
});
