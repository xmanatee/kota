import { isSecretReference, secretReferenceName } from "#core/config/secret-reference.js";
import type { McpServerConfig } from "#core/mcp/manager.js";

export type PrivateMcpTunnelProvider = "openai-secure-mcp-tunnel";

type PrivateTunnelConfigValue =
	| string
	| number
	| boolean
	| null
	| PrivateTunnelConfigValue[]
	| PrivateTunnelConfigObject;

type PrivateTunnelConfigObject = {
	[key: string]: PrivateTunnelConfigValue | undefined;
};

export type PrivateMcpTunnelTargetConfig =
	| (PrivateTunnelConfigObject & {
			type: "http";
			url: string;
	  })
	| (PrivateTunnelConfigObject & {
			type: "stdio";
			command: string;
			args?: string[];
	  });

export type PrivateMcpTunnelProfileConfig = PrivateTunnelConfigObject & {
	provider: PrivateMcpTunnelProvider;
	tunnelId: string;
	tunnelClientProfile: string;
	runtimeApiKeyRef: string;
	defaultTarget: string;
	targets: { [key: string]: PrivateMcpTunnelTargetConfig | undefined };
	serverKey?: string;
	tunnelClientCommand?: string;
	organizationId?: string;
	organizationIds?: string[];
	workspaceId?: string;
	workspaceIds?: string[];
};

export type McpRegistryModuleConfig = PrivateTunnelConfigObject & {
	privateTunnels?: { [key: string]: PrivateMcpTunnelProfileConfig | undefined };
};

export type PrivateMcpTunnelClientSetup = {
	command: string;
	args: string[];
	runtimeApiKey: {
		env: string;
		secretName: string;
	};
};

export type PrivateMcpTunnelDiagnosticCode =
	| "missing_tunnel_credentials"
	| "private_mcp_unreachable"
	| "missing_workspace_or_org_association"
	| "tunnel_client_unhealthy";

export type PrivateMcpTunnelDiagnosticStatus =
	| "ok"
	| "missing"
	| "unreachable"
	| "unhealthy"
	| "unknown";

export type PrivateMcpTunnelDiagnostic = {
	code: PrivateMcpTunnelDiagnosticCode;
	status: PrivateMcpTunnelDiagnosticStatus;
	message: string;
};

export type PrivateMcpTunnelTargetSummary = {
	name: string;
	type: PrivateMcpTunnelTargetConfig["type"];
	url?: string;
	command?: string;
	args?: string[];
};

export type PrivateMcpTunnelResolution = {
	provider: PrivateMcpTunnelProvider;
	profileName: string;
	tunnelId: string;
	tunnelClientProfile: string;
	runtimeApiKeySecretName: string;
	serverKey: string;
	tunnelClient: PrivateMcpTunnelClientSetup;
	config: McpServerConfig;
	target: PrivateMcpTunnelTargetSummary;
	association: {
		organizationIds: string[];
		workspaceIds: string[];
	};
	diagnostics: PrivateMcpTunnelDiagnostic[];
};

export type PrivateMcpTunnelInspectOptions = {
	target?: string;
	runtimeApiKeyPresent?: boolean;
	privateTargetReachable?: boolean;
	tunnelClientHealthy?: boolean;
};

const DEFAULT_TUNNEL_CLIENT_COMMAND = "tunnel-client";
const DEFAULT_CONTROL_PLANE_ENV = "CONTROL_PLANE_API_KEY";
const TUNNEL_ID_PATTERN = /^tunnel_[A-Za-z0-9_-]+$/;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export class PrivateMcpTunnelError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PrivateMcpTunnelError";
	}
}

export function resolvePrivateMcpTunnelProfile(
	profileName: string,
	profile: PrivateMcpTunnelProfileConfig,
	options: PrivateMcpTunnelInspectOptions = {},
): PrivateMcpTunnelResolution {
	assertSafeName(profileName, "profile name");
	const provider = requiredProvider(profile.provider);
	const tunnelId = requiredTunnelId(profile.tunnelId);
	const tunnelClientProfile = requiredSafeString(
		profile.tunnelClientProfile,
		"tunnelClientProfile",
	);
	const runtimeApiKeySecretName = requiredSecretName(profile.runtimeApiKeyRef);
	const targets = requiredTargets(profile.targets);
	const targetName = options.target ?? requiredSafeString(profile.defaultTarget, "defaultTarget");
	const target = targets.get(targetName);
	if (!target) {
		throw new PrivateMcpTunnelError(
			`private tunnel profile "${profileName}" target "${targetName}" is not allowlisted`,
		);
	}
	const tunnelClientCommand = optionalCommand(profile.tunnelClientCommand) ??
		DEFAULT_TUNNEL_CLIENT_COMMAND;
	const association = associationSummary(profile);
	const serverKey = optionalSafeString(profile.serverKey, "serverKey") ??
		`private-tunnel-${profileName}`;

	return {
		provider,
		profileName,
		tunnelId,
		tunnelClientProfile,
		runtimeApiKeySecretName,
		serverKey,
		tunnelClient: {
			command: tunnelClientCommand,
			args: ["run", "--profile", tunnelClientProfile],
			runtimeApiKey: {
				env: DEFAULT_CONTROL_PLANE_ENV,
				secretName: runtimeApiKeySecretName,
			},
		},
		config: targetMcpServerConfig(target),
		target: targetSummary(targetName, target),
		association,
		diagnostics: tunnelDiagnostics({ association, options }),
	};
}

function requiredProvider(value: PrivateTunnelConfigValue | undefined): PrivateMcpTunnelProvider {
	if (value !== "openai-secure-mcp-tunnel") {
		throw new PrivateMcpTunnelError(
			"private tunnel provider must be openai-secure-mcp-tunnel",
		);
	}
	return value;
}

function requiredTunnelId(value: PrivateTunnelConfigValue | undefined): string {
	const tunnelId = requiredSafeString(value, "tunnelId");
	if (!TUNNEL_ID_PATTERN.test(tunnelId)) {
		throw new PrivateMcpTunnelError("tunnelId must start with tunnel_ and contain only safe id characters");
	}
	return tunnelId;
}

function requiredSecretName(value: PrivateTunnelConfigValue | undefined): string {
	if (typeof value !== "string" || !isSecretReference(value)) {
		throw new PrivateMcpTunnelError(
			"runtimeApiKeyRef must be a secret reference like $OPENAI_TUNNEL_API_KEY",
		);
	}
	const name = secretReferenceName(value);
	if (!name) {
		throw new PrivateMcpTunnelError(
			"runtimeApiKeyRef must name a non-empty secret reference",
		);
	}
	return name;
}

function requiredTargets(
	value: PrivateTunnelConfigValue | undefined,
): Map<string, PrivateMcpTunnelTargetConfig> {
	const rawTargets = requireObject(value, "targets");
	const targets = new Map<string, PrivateMcpTunnelTargetConfig>();
	for (const [name, target] of Object.entries(rawTargets)) {
		assertSafeName(name, "target name");
		targets.set(name, normalizeTarget(target, name));
	}
	if (targets.size === 0) {
		throw new PrivateMcpTunnelError("targets must include at least one allowlisted private MCP target");
	}
	return targets;
}

function normalizeTarget(
	target: PrivateTunnelConfigValue | undefined,
	name: string,
): PrivateMcpTunnelTargetConfig {
	const rawTarget = requireObject(target, `target "${name}"`);
	const type = requiredString(rawTarget.type, `targets.${name}.type`);
	if (type === "http") {
		const url = requiredString(rawTarget.url, `targets.${name}.url`);
		try {
			const parsed = new URL(url);
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				throw new PrivateMcpTunnelError(
					`targets.${name}.url must use http or https`,
				);
			}
			return { type: "http", url: parsed.toString() };
		} catch (error) {
			if (error instanceof PrivateMcpTunnelError) throw error;
			throw new PrivateMcpTunnelError(`targets.${name}.url must be a valid URL`);
		}
	}
	if (type === "stdio") {
		const command = requiredString(rawTarget.command, `targets.${name}.command`);
		const args = optionalStringArray(rawTarget.args, `targets.${name}.args`);
		return {
			type: "stdio",
			command,
			...(args ? { args } : {}),
		};
	}
	throw new PrivateMcpTunnelError(`targets.${name}.type must be http or stdio`);
}

function associationSummary(profile: PrivateMcpTunnelProfileConfig): {
	organizationIds: string[];
	workspaceIds: string[];
} {
	return {
		organizationIds: uniqueStrings([
			...(profile.organizationId ? [profile.organizationId] : []),
			...(profile.organizationIds ?? []),
		]),
		workspaceIds: uniqueStrings([
			...(profile.workspaceId ? [profile.workspaceId] : []),
			...(profile.workspaceIds ?? []),
		]),
	};
}

function tunnelDiagnostics(args: {
	association: PrivateMcpTunnelResolution["association"];
	options: PrivateMcpTunnelInspectOptions;
}): PrivateMcpTunnelDiagnostic[] {
	return [
		credentialDiagnostic(args.options.runtimeApiKeyPresent),
		associationDiagnostic(args.association),
		targetDiagnostic(args.options.privateTargetReachable),
		tunnelClientDiagnostic(args.options.tunnelClientHealthy),
	];
}

function credentialDiagnostic(present: boolean | undefined): PrivateMcpTunnelDiagnostic {
	if (present === true) {
		return {
			code: "missing_tunnel_credentials",
			status: "ok",
			message: "Runtime API key secret is present.",
		};
	}
	if (present === false) {
		return {
			code: "missing_tunnel_credentials",
			status: "missing",
			message: "Runtime API key secret is missing.",
		};
	}
	return {
		code: "missing_tunnel_credentials",
		status: "unknown",
		message: "Runtime API key secret has not been checked.",
	};
}

function associationDiagnostic(
	association: PrivateMcpTunnelResolution["association"],
): PrivateMcpTunnelDiagnostic {
	if (association.organizationIds.length > 0 || association.workspaceIds.length > 0) {
		return {
			code: "missing_workspace_or_org_association",
			status: "ok",
			message: "Tunnel profile declares at least one workspace or organization association.",
		};
	}
	return {
		code: "missing_workspace_or_org_association",
		status: "missing",
		message: "Tunnel profile does not declare a workspace or organization association.",
	};
}

function targetDiagnostic(reachable: boolean | undefined): PrivateMcpTunnelDiagnostic {
	if (reachable === true) {
		return {
			code: "private_mcp_unreachable",
			status: "ok",
			message: "Private MCP target reachability check passed.",
		};
	}
	if (reachable === false) {
		return {
			code: "private_mcp_unreachable",
			status: "unreachable",
			message: "Private MCP target is unreachable from the tunnel-client host.",
		};
	}
	return {
		code: "private_mcp_unreachable",
		status: "unknown",
		message: "Private MCP target reachability has not been checked.",
	};
}

function tunnelClientDiagnostic(healthy: boolean | undefined): PrivateMcpTunnelDiagnostic {
	if (healthy === true) {
		return {
			code: "tunnel_client_unhealthy",
			status: "ok",
			message: "Tunnel client health check passed.",
		};
	}
	if (healthy === false) {
		return {
			code: "tunnel_client_unhealthy",
			status: "unhealthy",
			message: "Tunnel client is not healthy or not polling.",
		};
	}
	return {
		code: "tunnel_client_unhealthy",
		status: "unknown",
		message: "Tunnel client health has not been checked.",
	};
}

function targetSummary(
	name: string,
	target: PrivateMcpTunnelTargetConfig,
): PrivateMcpTunnelTargetSummary {
	if (target.type === "http") return { name, type: target.type, url: target.url };
	return {
		name,
		type: target.type,
		command: target.command,
		...(target.args ? { args: [...target.args] } : {}),
	};
}

function targetMcpServerConfig(target: PrivateMcpTunnelTargetConfig): McpServerConfig {
	if (target.type === "http") return { type: "http", url: target.url };
	return {
		command: target.command,
		...(target.args ? { args: [...target.args] } : {}),
	};
}

function requiredSafeString(value: PrivateTunnelConfigValue | undefined, label: string): string {
	const out = requiredString(value, label);
	assertSafeName(out, label);
	return out;
}

function optionalSafeString(
	value: PrivateTunnelConfigValue | undefined,
	label: string,
): string | undefined {
	if (value === undefined) return undefined;
	return requiredSafeString(value, label);
}

function optionalCommand(value: PrivateTunnelConfigValue | undefined): string | undefined {
	if (value === undefined) return undefined;
	return requiredString(value, "tunnelClientCommand");
}

function requiredString(value: PrivateTunnelConfigValue | undefined, label: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new PrivateMcpTunnelError(`${label} must be a non-empty string`);
	}
	return value;
}

function optionalStringArray(
	value: PrivateTunnelConfigValue | undefined,
	label: string,
): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) {
		throw new PrivateMcpTunnelError(`${label} must be an array of strings`);
	}
	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") {
			throw new PrivateMcpTunnelError(`${label} must be an array of strings`);
		}
		out.push(entry);
	}
	return out;
}

function assertSafeName(value: string, label: string): void {
	if (!SAFE_NAME_PATTERN.test(value)) {
		throw new PrivateMcpTunnelError(`${label} must contain only letters, digits, dots, dashes, or underscores`);
	}
}

function uniqueStrings(values: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		if (value.length === 0 || seen.has(value)) continue;
		seen.add(value);
		out.push(value);
	}
	return out;
}

function requireObject(
	value: PrivateTunnelConfigValue | undefined,
	label: string,
): PrivateTunnelConfigObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new PrivateMcpTunnelError(`${label} must be an object`);
	}
	return value;
}
