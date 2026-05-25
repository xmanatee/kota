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
});
