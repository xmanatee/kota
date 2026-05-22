import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import { buildMcpServerDiscoverCapabilities } from "./mcp-capabilities.js";
import { MCP_DRAFT_PROTOCOL_VERSION } from "./mcp-protocol-types.js";
import {
	type McpRegistryMetadata,
	readMcpRegistryMetadata,
	validateMcpRegistryMetadata,
} from "./registry-metadata.js";

export const MCP_SERVER_CARD_RESOURCE_URI = "mcp://server-card.json";
export const MCP_SERVER_CARD_WELL_KNOWN_PATH = "/.well-known/mcp/server-card.json";
export const MCP_SERVER_CARD_SCHEMA_URL =
	"https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json";
export const MCP_SERVER_CARD_VERSION = "1.0";
export const MCP_STREAMABLE_HTTP_DEFAULT_ENDPOINT_PATH = "/mcp";

export function readMcpServerCard(
	options: { streamableHttpPath?: string } = {},
): KotaJsonObject {
	return buildMcpServerCard({
		metadata: readMcpRegistryMetadata(),
		streamableHttpPath: options.streamableHttpPath ?? MCP_STREAMABLE_HTTP_DEFAULT_ENDPOINT_PATH,
	});
}

export function buildMcpServerCard(args: {
	metadata: McpRegistryMetadata;
	streamableHttpPath?: string;
}): KotaJsonObject {
	const errors = validateMcpRegistryMetadata(args.metadata);
	if (errors.length > 0) {
		throw new Error(`MCP Server Card metadata is invalid: ${errors.join("; ")}`);
	}

	const { serverJson } = args.metadata;
	const streamableHttpPath =
		args.streamableHttpPath ?? MCP_STREAMABLE_HTTP_DEFAULT_ENDPOINT_PATH;
	const card: KotaJsonObject = {
		$schema: MCP_SERVER_CARD_SCHEMA_URL,
		version: MCP_SERVER_CARD_VERSION,
		protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
		serverInfo: {
			name: serverJson.name,
			...(serverJson.title !== undefined && { title: serverJson.title }),
			version: serverJson.version,
		},
		description: serverJson.description,
		transport: {
			type: "streamable-http",
			endpoint: streamableHttpPath,
		},
		capabilities: buildMcpServerDiscoverCapabilities(),
	};
	assertPublicServerCard(card);
	return card;
}

function assertPublicServerCard(card: KotaJsonObject): void {
	const serialized = JSON.stringify(card);
	const forbidden = serialized.match(
		/127\.0\.0\.1|localhost|\/Users\/|\/home\/|\/private\/|\/tmp\/|authorization|credential|password|secret|token/i,
	);
	if (forbidden) {
		throw new Error(
			`MCP Server Card contains non-public metadata matching "${forbidden[0]}"`,
		);
	}
}
