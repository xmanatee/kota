import type { KotaJsonObject, KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import {
	hasSecretLikeQueryParameter,
	isPublicHttpsEndpoint,
	type McpRegistryMetadata,
	readMcpRegistryMetadata,
	validateMcpRegistryMetadata,
} from "./registry-metadata.js";

export const MCP_SERVER_CARD_WELL_KNOWN_PATH = "/.well-known/mcp/server-card";
export const MCP_SERVER_CARD_RESOURCE_URI = "mcp://server-card.json";
export const MCP_SERVER_CARD_SCHEMA_URL =
	"https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";

export function readMcpServerCard(): KotaJsonObject {
	return buildMcpServerCard({
		metadata: readMcpRegistryMetadata(),
	});
}

export function buildMcpServerCard(args: {
	metadata: McpRegistryMetadata;
}): KotaJsonObject {
	const errors = validateMcpRegistryMetadata(args.metadata);
	if (errors.length > 0) {
		throw new Error(`MCP Server Card metadata is invalid: ${errors.join("; ")}`);
	}

	const { serverJson } = args.metadata;
	const remotes = serverJson.remotes && serverJson.remotes.length > 0
		? serverJson.remotes.map((remote) => ({ ...remote }))
		: undefined;
	const card: KotaJsonObject = {
		$schema: MCP_SERVER_CARD_SCHEMA_URL,
		name: serverJson.name,
		...(serverJson.title !== undefined && { title: serverJson.title }),
		description: serverJson.description,
		repository: {
			source: serverJson.repository.source,
			url: serverJson.repository.url,
		},
		version: serverJson.version,
		...(remotes !== undefined && { remotes }),
		...(serverJson._meta !== undefined && { _meta: serverJson._meta }),
	};
	assertPublicServerCard(card);
	return card;
}

function assertPublicServerCard(card: KotaJsonObject): void {
	const violation = findNonPublicMetadata(card, "$");
	if (violation) {
		throw new Error(
			`MCP Server Card contains non-public metadata at ${violation.path}: ${violation.reason}`,
		);
	}
}

type PublicMetadataViolation = {
	path: string;
	reason: string;
};

const PUBLICATION_SENSITIVE_METADATA_PATTERN =
	/authorization|credential|password|secret|token|api[-_]?key|session[-_]?id|user[-_]?id/i;

const LOCAL_METADATA_VALUE_PATTERN =
	/127\.0\.0\.1|localhost|\/Users\/|\/home\/|\/private\/|\/tmp\//i;

const EMBEDDED_URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;

function findNonPublicMetadata(
	value: KotaJsonValue,
	path: string,
): PublicMetadataViolation | null {
	if (typeof value === "string") {
		return findNonPublicStringMetadata(value, path);
	}
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			const violation = findNonPublicMetadata(item, `${path}[${index}]`);
			if (violation) return violation;
		}
		return null;
	}
	if (isJsonObject(value)) {
		for (const [key, item] of Object.entries(value)) {
			const keyMatch = key.match(PUBLICATION_SENSITIVE_METADATA_PATTERN);
			const itemPath = `${path}.${key}`;
			if (keyMatch) {
				return {
					path: itemPath,
					reason: `field name matches "${keyMatch[0]}"`,
				};
			}
			const violation = findNonPublicMetadata(item, itemPath);
			if (violation) return violation;
		}
	}
	return null;
}

function findNonPublicStringMetadata(
	value: string,
	path: string,
): PublicMetadataViolation | null {
	const sensitiveMatch = value.match(PUBLICATION_SENSITIVE_METADATA_PATTERN);
	if (sensitiveMatch) {
		return {
			path,
			reason: `value matches "${sensitiveMatch[0]}"`,
		};
	}

	const localMatch = value.match(LOCAL_METADATA_VALUE_PATTERN);
	if (localMatch) {
		return {
			path,
			reason: `value matches "${localMatch[0]}"`,
		};
	}

	const privateUrl = findNonPublicUrl(value);
	if (privateUrl) {
		return {
			path,
			reason: `URL "${privateUrl}" is not a public HTTPS endpoint`,
		};
	}

	return null;
}

function findNonPublicUrl(value: string): string | null {
	for (const match of value.matchAll(EMBEDDED_URL_PATTERN)) {
		const rawUrl = trimUrlPunctuation(match[0] ?? "");
		const url = parseUrl(rawUrl);
		if (!url) continue;
		if (
			!isPublicHttpsEndpoint(url) ||
			url.username ||
			url.password ||
			hasSecretLikeQueryParameter(url)
		) {
			return rawUrl;
		}
	}
	return null;
}

function trimUrlPunctuation(rawUrl: string): string {
	return rawUrl.replace(/[),.;]+$/u, "");
}

function parseUrl(rawUrl: string): URL | null {
	try {
		return new URL(rawUrl);
	} catch {
		return null;
	}
}

function isJsonObject(value: KotaJsonValue): value is KotaJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
