import { describe, expect, it } from "vitest";
import {
	PrivateMcpTunnelError,
	type PrivateMcpTunnelProfileConfig,
	resolvePrivateMcpTunnelProfile,
} from "./private-tunnel.js";

function profile(overrides: Partial<PrivateMcpTunnelProfileConfig> = {}): PrivateMcpTunnelProfileConfig {
	return {
		provider: "openai-secure-mcp-tunnel",
		tunnelId: "tunnel_0123456789abcdef",
		tunnelClientProfile: "local-private-mcp",
		runtimeApiKeyRef: "$OPENAI_TUNNEL_API_KEY",
		defaultTarget: "kota",
		workspaceId: "ws_acme",
		targets: {
			kota: {
				type: "http",
				url: "http://127.0.0.1:8765/mcp",
			},
		},
		...overrides,
	};
}

describe("private MCP tunnel profiles", () => {
	it("resolves an OpenAI tunnel profile to the allowlisted MCP target config", () => {
		const resolved = resolvePrivateMcpTunnelProfile("default", profile(), {
			runtimeApiKeyPresent: true,
			privateTargetReachable: true,
			tunnelClientHealthy: true,
		});

		expect(resolved).toMatchObject({
			provider: "openai-secure-mcp-tunnel",
			profileName: "default",
			tunnelId: "tunnel_0123456789abcdef",
			runtimeApiKeySecretName: "OPENAI_TUNNEL_API_KEY",
			serverKey: "private-tunnel-default",
			tunnelClient: {
				command: "tunnel-client",
				args: ["run", "--profile", "local-private-mcp"],
				runtimeApiKey: {
					env: "CONTROL_PLANE_API_KEY",
					secretName: "OPENAI_TUNNEL_API_KEY",
				},
			},
			target: {
				name: "kota",
				type: "http",
				url: "http://127.0.0.1:8765/mcp",
			},
			config: {
				type: "http",
				url: "http://127.0.0.1:8765/mcp",
			},
		});
		expect(JSON.stringify(resolved.config)).not.toContain("tunnel-client");
		expect(JSON.stringify(resolved.config)).not.toContain("OPENAI_TUNNEL_API_KEY");
		expect(resolved.diagnostics.map((diagnostic) => diagnostic.status)).toEqual([
			"ok",
			"ok",
			"ok",
			"ok",
		]);
	});

	it("rejects raw runtime API keys instead of accepting secrets in config", () => {
		expect(() =>
			resolvePrivateMcpTunnelProfile(
				"default",
				profile({ runtimeApiKeyRef: "sk-test-raw-secret" }),
			),
		).toThrow(
			new PrivateMcpTunnelError(
				"runtimeApiKeyRef must be a secret reference like $OPENAI_TUNNEL_API_KEY",
			),
		);
	});

	it("rejects targets that are not explicitly allowlisted", () => {
		expect(() =>
			resolvePrivateMcpTunnelProfile("default", profile(), { target: "payments" }),
		).toThrow(
			new PrivateMcpTunnelError(
				'private tunnel profile "default" target "payments" is not allowlisted',
			),
		);
	});

	it("validates stdio target shape in the allowlist", () => {
		const resolved = resolvePrivateMcpTunnelProfile(
			"default",
			profile({
				defaultTarget: "local-stdio",
				targets: {
					"local-stdio": {
						type: "stdio",
						command: "node",
						args: ["server.mjs"],
					},
				},
			}),
		);

		expect(resolved.target).toEqual({
			name: "local-stdio",
			type: "stdio",
			command: "node",
			args: ["server.mjs"],
		});
		expect(resolved.config).toEqual({
			command: "node",
			args: ["server.mjs"],
		});
	});

	it("distinguishes missing credentials, association, reachability, and client health diagnostics", () => {
		const resolved = resolvePrivateMcpTunnelProfile(
			"default",
			profile({ workspaceId: undefined, organizationId: undefined }),
			{
				runtimeApiKeyPresent: false,
				privateTargetReachable: false,
				tunnelClientHealthy: false,
			},
		);

		expect(resolved.diagnostics).toEqual([
			{
				code: "missing_tunnel_credentials",
				status: "missing",
				message: "Runtime API key secret is missing.",
			},
			{
				code: "missing_workspace_or_org_association",
				status: "missing",
				message: "Tunnel profile does not declare a workspace or organization association.",
			},
			{
				code: "private_mcp_unreachable",
				status: "unreachable",
				message: "Private MCP target is unreachable from the tunnel-client host.",
			},
			{
				code: "tunnel_client_unhealthy",
				status: "unhealthy",
				message: "Tunnel client is not healthy or not polling.",
			},
		]);
	});
});
