import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type { McpImplementation, McpProtocolVersion } from "./mcp-protocol-types.js";

export type DeprecatedMcpFeature = "roots" | "sampling" | "logging";

export type DeprecatedMcpCapabilityWarning = {
	feature: DeprecatedMcpFeature;
	peer: McpImplementation;
	protocolVersion: McpProtocolVersion;
	source: string;
};

function peerKey(peer: McpImplementation): string {
	return `${peer.name}\u0000${peer.version}`;
}

export function hasDeprecatedClientCapability(
	capabilities: KotaJsonObject,
	feature: Extract<DeprecatedMcpFeature, "roots" | "sampling">,
): boolean {
	const value = capabilities[feature];
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class DeprecatedMcpCapabilityWarnings {
	private readonly emitted = new Set<string>();

	constructor(private readonly emit: (message: string) => void) {}

	warn(args: DeprecatedMcpCapabilityWarning): void {
		const key = `${peerKey(args.peer)}\u0000${args.feature}`;
		if (this.emitted.has(key)) return;
		this.emitted.add(key);
		this.emit(
			`deprecated MCP capability negotiated: feature "${args.feature}" with peer ` +
				`"${args.peer.name}" (${args.peer.version}) using protocol ${args.protocolVersion}; ` +
				`${args.source} is compatibility-only during the SEP-2577 deprecation window.`,
		);
	}
}
