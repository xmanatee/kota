import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { buildMcpRegistryCommand } from "./index.js";

describe("mcp-registry command", () => {
	it("fetches one server version from a configurable registry URL and prints mcpServers JSON", async () => {
		const stdout: string[] = [];
		const stderr: string[] = [];
		const fetchRegistry = vi.fn(async (_url: string) => {
			return new Response(
				JSON.stringify({
					server: {
						name: "io.github.example/filesystem",
						description: "Filesystem",
						version: "1.0.0",
						packages: [
							{
								registryType: "npm",
								identifier: "@example/filesystem",
								version: "1.0.0",
								transport: { type: "stdio" },
							},
						],
					},
					_meta: {
						"io.modelcontextprotocol.registry/official": {
							status: "active",
						},
					},
				}),
				{ status: 200 },
			);
		});
		const program = new Command();
		program.version("0.1.0");
		program.exitOverride();
		program.addCommand(
			buildMcpRegistryCommand({
				fetchRegistry,
				stdout: { write: (chunk) => stdout.push(chunk) },
				stderr: { write: (chunk) => stderr.push(chunk) },
			}),
		);

		await program.parseAsync(
			[
				"node",
				"kota",
				"mcp-registry",
				"import",
				"io.github.example/filesystem",
				"--server-version",
				"1.0.0",
				"--registry-url",
				"https://registry.example.test/root/",
			],
			{ from: "node" },
		);

		expect(fetchRegistry).toHaveBeenCalledWith(
			"https://registry.example.test/root/v0.1/servers/io.github.example%2Ffilesystem/versions/1.0.0",
		);
		expect(stderr).toEqual([]);
		expect(JSON.parse(stdout.join(""))).toEqual({
			mcpServers: {
				filesystem: {
					command: "pnpm",
					args: ["dlx", "@example/filesystem@1.0.0"],
				},
			},
		});
	});

	it("inspects a private tunnel profile without printing secret values", async () => {
		const stdout: string[] = [];
		const stderr: string[] = [];
		const getSecret = vi.fn((name: string) =>
			name === "OPENAI_TUNNEL_API_KEY" ? "sk-secret-value" : null
		);
		const program = new Command();
		program.version("0.1.0");
		program.exitOverride();
		program.addCommand(
			buildMcpRegistryCommand({
				getConfig: () => ({
					privateTunnels: {
						default: {
							provider: "openai-secure-mcp-tunnel",
							tunnelId: "tunnel_0123456789abcdef",
							tunnelClientProfile: "local-private-mcp",
							runtimeApiKeyRef: "$OPENAI_TUNNEL_API_KEY",
							defaultTarget: "kota",
							organizationId: "org_acme",
							targets: {
								kota: {
									type: "http",
									url: "http://127.0.0.1:8765/mcp",
								},
							},
						},
					},
				}),
				getSecret,
				stdout: { write: (chunk) => stdout.push(chunk) },
				stderr: { write: (chunk) => stderr.push(chunk) },
			}),
		);

		await program.parseAsync(
			[
				"node",
				"kota",
				"mcp-registry",
				"tunnel",
				"inspect",
				"--private-target-reachable",
				"true",
				"--tunnel-client-healthy",
				"false",
				"--json",
			],
			{ from: "node" },
		);

		const output = stdout.join("");
		expect(stderr).toEqual([]);
		expect(output).not.toContain("sk-secret-value");
		const parsed = JSON.parse(output);
		expect(parsed).toMatchObject({
			profile: "default",
			runtimeApiKeySecretName: "OPENAI_TUNNEL_API_KEY",
			tunnelClient: {
				command: "tunnel-client",
				args: ["run", "--profile", "local-private-mcp"],
				runtimeApiKey: {
					env: "CONTROL_PLANE_API_KEY",
					secretName: "OPENAI_TUNNEL_API_KEY",
				},
			},
			mcpServers: {
				"private-tunnel-default": {
					type: "http",
					url: "http://127.0.0.1:8765/mcp",
				},
			},
			diagnostics: [
				{ code: "missing_tunnel_credentials", status: "ok" },
				{ code: "missing_workspace_or_org_association", status: "ok" },
				{ code: "private_mcp_unreachable", status: "ok" },
				{ code: "tunnel_client_unhealthy", status: "unhealthy" },
			],
		});
		expect(getSecret).toHaveBeenCalledWith("OPENAI_TUNNEL_API_KEY");
		expect(JSON.stringify(parsed.mcpServers)).not.toContain("tunnel-client");
		expect(JSON.stringify(parsed.mcpServers)).not.toContain("OPENAI_TUNNEL_API_KEY");
	});
});
