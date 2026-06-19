import { Command } from "commander";
import { secretReferenceName } from "#core/config/secret-reference.js";
import {
	type McpRegistryModuleConfig,
	PrivateMcpTunnelError,
	type PrivateMcpTunnelResolution,
	resolvePrivateMcpTunnelProfile,
} from "./private-tunnel.js";
import { RegistryImportError } from "./registry-import.js";

const DEFAULT_TUNNEL_PROFILE = "default";

type Writable = {
	write(chunk: string): void;
};

export type PrivateTunnelCommandDeps = {
	getConfig?: () => McpRegistryModuleConfig | undefined;
	getSecret?: (name: string) => string | null;
	stdout?: Writable;
	stderr?: Writable;
};

type TunnelInspectOptions = {
	target?: string;
	json?: boolean;
	privateTargetReachable?: string;
	tunnelClientHealthy?: string;
};

export function buildPrivateTunnelCommand(
	deps: PrivateTunnelCommandDeps = {},
): Command {
	const getConfig = deps.getConfig ?? (() => undefined);
	const getSecret = deps.getSecret ?? (() => null);
	const stdout = deps.stdout ?? process.stdout;
	const stderr = deps.stderr ?? process.stderr;
	const tunnel = new Command("tunnel")
		.description("Inspect private MCP tunnel profiles from KOTA module config");

	tunnel
		.command("inspect [profileName]")
		.description("Resolve a private MCP tunnel profile to sanitized MCP setup JSON")
		.option("--target <name>", "Allowlisted private target to inspect")
		.option("--private-target-reachable <state>", "Reachability probe result: true or false")
		.option("--tunnel-client-healthy <state>", "Tunnel client health probe result: true or false")
		.option("--json", "Output JSON")
		.action((profileName: string | undefined, opts: TunnelInspectOptions) => {
			try {
				const resolved = inspectPrivateTunnelProfile({
					config: getConfig(),
					getSecret,
					profileName: profileName ?? DEFAULT_TUNNEL_PROFILE,
					target: opts.target,
					privateTargetReachable: parseOptionalBoolean(
						opts.privateTargetReachable,
						"--private-target-reachable",
					),
					tunnelClientHealthy: parseOptionalBoolean(
						opts.tunnelClientHealthy,
						"--tunnel-client-healthy",
					),
				});
				if (opts.json === true) {
					stdout.write(`${JSON.stringify(privateTunnelOutput(resolved), null, 2)}\n`);
					return;
				}
				stdout.write(formatPrivateTunnelInspect(resolved));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				stderr.write(`Error: ${message}\n`);
				process.exitCode = 1;
			}
		});

	return tunnel;
}

type InspectPrivateTunnelProfileArgs = {
	config: McpRegistryModuleConfig | undefined;
	getSecret: (name: string) => string | null;
	profileName: string;
	target?: string;
	privateTargetReachable?: boolean;
	tunnelClientHealthy?: boolean;
};

function inspectPrivateTunnelProfile(
	args: InspectPrivateTunnelProfileArgs,
): PrivateMcpTunnelResolution {
	const profile = args.config?.privateTunnels?.[args.profileName];
	if (!profile) {
		throw new PrivateMcpTunnelError(
			`private tunnel profile "${args.profileName}" is not configured`,
		);
	}
	const secretName = typeof profile.runtimeApiKeyRef === "string"
		? secretReferenceName(profile.runtimeApiKeyRef)
		: null;
	return resolvePrivateMcpTunnelProfile(args.profileName, profile, {
		target: args.target,
		runtimeApiKeyPresent: secretName !== null
			? args.getSecret(secretName) !== null
			: undefined,
		privateTargetReachable: args.privateTargetReachable,
		tunnelClientHealthy: args.tunnelClientHealthy,
	});
}

function parseOptionalBoolean(
	value: string | undefined,
	label: string,
): boolean | undefined {
	if (value === undefined) return undefined;
	if (value === "true") return true;
	if (value === "false") return false;
	throw new RegistryImportError(`${label} must be true or false`);
}

function privateTunnelOutput(resolved: PrivateMcpTunnelResolution): object {
	return {
		profile: resolved.profileName,
		provider: resolved.provider,
		tunnelId: resolved.tunnelId,
		tunnelClientProfile: resolved.tunnelClientProfile,
		runtimeApiKeySecretName: resolved.runtimeApiKeySecretName,
		target: resolved.target,
		association: resolved.association,
		tunnelClient: resolved.tunnelClient,
		mcpServers: {
			[resolved.serverKey]: resolved.config,
		},
		diagnostics: resolved.diagnostics,
	};
}

function formatPrivateTunnelInspect(resolved: PrivateMcpTunnelResolution): string {
	const diagnostics = resolved.diagnostics
		.map((diagnostic) => `  ${diagnostic.code}: ${diagnostic.status} - ${diagnostic.message}`)
		.join("\n");
	return [
		`Profile: ${resolved.profileName}`,
		`Provider: ${resolved.provider}`,
		`Tunnel: ${resolved.tunnelId}`,
		`Target: ${resolved.target.name} (${resolved.target.type})`,
		`MCP server key: ${resolved.serverKey}`,
		`Tunnel client: ${resolved.tunnelClient.command} ${resolved.tunnelClient.args.join(" ")}`,
		`Runtime key secret: ${resolved.tunnelClient.runtimeApiKey.secretName}`,
		"Diagnostics:",
		diagnostics,
		"",
	].join("\n");
}
