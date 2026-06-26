import type {
	KotaJsonObject,
	KotaJsonValue,
	KotaMcpAnnotations,
	KotaMcpPreservedContent,
	KotaToolResultBlock,
	KotaToolResultContentBlock,
} from "#core/agent-harness/message-protocol.js";

const TOOL_RESULT_MODEL_PROJECTION_CHAR_LIMIT = 20_000;

type ProjectionJson = KotaJsonValue | KotaMcpAnnotations;

/** Extract the bounded text projection sent to OpenAI-compatible providers. */
export function extractToolResultContent(block: KotaToolResultBlock): string {
	const prefix = block.is_error ? "[ERROR] " : "";
	const sections: string[] = [];
	if (typeof block.content === "string") {
		if (block.content.length > 0) sections.push(block.content);
	} else {
		for (const entry of block.content) {
			sections.push(projectToolResultContentBlock(entry));
		}
	}
	if (block.structuredContent !== undefined) {
		sections.push(
			`[structuredContent]\n${stableJsonStringify(block.structuredContent)}`,
		);
	}
	if (block._meta !== undefined) {
		sections.push(formatMetaKeys("tool result _meta", block._meta));
	}
	return truncateProjection(`${prefix}${sections.filter(Boolean).join("\n")}`);
}

function projectToolResultContentBlock(
	block: KotaToolResultContentBlock,
): string {
	if (block.type === "text") {
		return appendContentMetadata(block.text, block.annotations, block._meta);
	}
	if (block.type === "image") {
		return appendContentMetadata(
			`[image omitted: ${block.source.media_type}, base64 bytes=${block.source.data.length}]`,
			block.annotations,
			block._meta,
		);
	}
	return projectMcpContent(block.content);
}

function projectMcpContent(content: KotaMcpPreservedContent): string {
	if (content.type === "audio") {
		return appendContentMetadata(
			`[MCP audio omitted: ${content.mimeType}, base64 bytes=${content.data.length}]`,
			content.annotations,
			content._meta,
		);
	}
	if (content.type === "resource") {
		const label = content.resource.mimeType
			? `${content.resource.uri} ${content.resource.mimeType}`
			: content.resource.uri;
		if ("text" in content.resource) {
			return appendContentMetadata(
				`[MCP resource: ${label}]\n${content.resource.text}`,
				content.annotations,
				content._meta,
				content.resource._meta,
			);
		}
		return appendContentMetadata(
			`[MCP resource blob omitted: ${label}, base64 bytes=${content.resource.blob.length}]`,
			content.annotations,
			content._meta,
			content.resource._meta,
		);
	}
	if (content.type === "resource_link") {
		const details = [
			`uri=${content.uri}`,
			`name=${content.name}`,
			content.title !== undefined ? `title=${content.title}` : "",
			content.description !== undefined
				? `description=${content.description}`
				: "",
			content.mimeType !== undefined ? `mimeType=${content.mimeType}` : "",
			content.size !== undefined ? `size=${content.size}` : "",
		].filter(Boolean);
		return appendContentMetadata(
			`[MCP resource link: ${details.join(", ")}]`,
			content.annotations,
			content._meta,
		);
	}
	return `[MCP content omitted: type=${content.mcpType}, raw keys=${sortedKeys(content.raw).join(",")}]`;
}

function appendContentMetadata(
	text: string,
	annotations: KotaMcpAnnotations | undefined,
	_meta: KotaJsonObject | undefined,
	resourceMeta?: KotaJsonObject,
): string {
	const metadata: string[] = [];
	if (annotations !== undefined) {
		metadata.push(`[annotations]\n${stableJsonStringify(annotations)}`);
	}
	if (_meta !== undefined) {
		metadata.push(formatMetaKeys("content _meta", _meta));
	}
	if (resourceMeta !== undefined) {
		metadata.push(formatMetaKeys("resource _meta", resourceMeta));
	}
	if (metadata.length === 0) return text;
	return `${text}\n${metadata.join("\n")}`;
}

function formatMetaKeys(label: string, value: KotaJsonObject): string {
	return `[${label} keys: ${sortedKeys(value).join(",") || "none"}]`;
}

function sortedKeys(value: KotaJsonObject): string[] {
	return Object.keys(value).sort();
}

function stableJsonStringify(value: KotaJsonObject | KotaMcpAnnotations): string {
	return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value: ProjectionJson): ProjectionJson {
	if (Array.isArray(value)) {
		return value.map((entry) =>
			sortJson(entry as ProjectionJson),
		) as KotaJsonValue[];
	}
	if (value === null || typeof value !== "object") return value;
	const sorted: KotaJsonObject = {};
	for (const [key, nested] of Object.entries(value).sort(([left], [right]) =>
		left.localeCompare(right),
	)) {
		sorted[key] = sortJson(nested as ProjectionJson) as KotaJsonValue;
	}
	return sorted;
}

function truncateProjection(text: string): string {
	if (text.length <= TOOL_RESULT_MODEL_PROJECTION_CHAR_LIMIT) return text;
	const omitted = text.length - TOOL_RESULT_MODEL_PROJECTION_CHAR_LIMIT;
	return `${text.slice(0, TOOL_RESULT_MODEL_PROJECTION_CHAR_LIMIT)}\n[... ${omitted} chars truncated from tool result projection ...]`;
}
