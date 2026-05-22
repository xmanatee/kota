import type {
  KotaJsonObject,
  KotaJsonValue,
  KotaMcpAnnotations,
  KotaMcpBlobResourceContents,
  KotaMcpIcon,
  KotaMcpResourceContents,
  KotaMcpTextResourceContents,
} from "#core/agent-harness/message-protocol.js";
import {
  optionalJsonObject,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requireString,
} from "./client-decode-utils.js";
import type { McpResultKind, McpToolContentBlock } from "./client-protocol.js";

export function decodeAnnotations(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): KotaMcpAnnotations | undefined {
  const object = optionalJsonObject(value, label, kind);
  if (!object) return undefined;
  const audience = optionalStringArray(object.audience, `${label}.audience`, kind);
  if (audience?.some((role) => role !== "user" && role !== "assistant")) {
    throw new Error(
      `Malformed MCP ${kind} result: ${label}.audience must contain user or assistant`,
    );
  }
  const priority = optionalNumber(object.priority, `${label}.priority`, kind);
  const lastModified = optionalString(object.lastModified, `${label}.lastModified`, kind);
  return {
    ...(audience ? { audience: audience as Array<"user" | "assistant"> } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(lastModified !== undefined ? { lastModified } : {}),
  };
}

export function decodeTextResourceContents(
  object: KotaJsonObject,
  label: string,
  kind: McpResultKind = "tools/call",
): KotaMcpTextResourceContents {
  const mimeType = optionalString(object.mimeType, `${label}.mimeType`, kind);
  const meta = optionalJsonObject(object._meta, `${label}._meta`, kind);
  return {
    uri: requireString(object.uri, `${label}.uri`, kind),
    ...(mimeType !== undefined ? { mimeType } : {}),
    text: requireString(object.text, `${label}.text`, kind),
    ...(meta ? { _meta: meta } : {}),
  };
}

export function decodeBlobResourceContents(
  object: KotaJsonObject,
  label: string,
  kind: McpResultKind = "tools/call",
): KotaMcpBlobResourceContents {
  const mimeType = optionalString(object.mimeType, `${label}.mimeType`, kind);
  const meta = optionalJsonObject(object._meta, `${label}._meta`, kind);
  return {
    uri: requireString(object.uri, `${label}.uri`, kind),
    ...(mimeType !== undefined ? { mimeType } : {}),
    blob: requireString(object.blob, `${label}.blob`, kind),
    ...(meta ? { _meta: meta } : {}),
  };
}

export function decodeResourceContents(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): KotaMcpResourceContents {
  const object = optionalJsonObject(value, label, kind);
  if (!object) {
    throw new Error(`Malformed MCP ${kind} result: ${label} must be an object`);
  }
  if (typeof object.text === "string") return decodeTextResourceContents(object, label, kind);
  if (typeof object.blob === "string") return decodeBlobResourceContents(object, label, kind);
  throw new Error(`Malformed MCP ${kind} result: ${label} must include text or blob`);
}

export function decodeIcons(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): KotaMcpIcon[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Malformed MCP ${kind} result: ${label} must be an array`);
  }
  return value.map((entry, index) => {
    const object = optionalJsonObject(entry, `${label}[${index}]`, kind);
    if (!object) {
      throw new Error(`Malformed MCP ${kind} result: ${label}[${index}] must be an object`);
    }
    const mimeType = optionalString(object.mimeType, `${label}[${index}].mimeType`, kind);
    const sizes = optionalStringArray(object.sizes, `${label}[${index}].sizes`, kind);
    const theme = optionalString(object.theme, `${label}[${index}].theme`, kind);
    if (theme !== undefined && theme !== "light" && theme !== "dark") {
      throw new Error(
        `Malformed MCP ${kind} result: ${label}[${index}].theme must be light or dark`,
      );
    }
    return {
      src: requireString(object.src, `${label}[${index}].src`, kind),
      ...(mimeType !== undefined ? { mimeType } : {}),
      ...(sizes !== undefined ? { sizes } : {}),
      ...(theme !== undefined ? { theme: theme as "light" | "dark" } : {}),
    };
  });
}

export function decodeMcpContentBlock(
  value: KotaJsonValue,
  indexOrLabel: number | string,
  kind: McpResultKind = "tools/call",
): McpToolContentBlock {
  const label = typeof indexOrLabel === "number" ? `content[${indexOrLabel}]` : indexOrLabel;
  const object = optionalJsonObject(value, label, kind);
  if (!object) {
    throw new Error(`Malformed MCP ${kind} result: ${label} must be an object`);
  }
  const type = requireString(object.type, `${label}.type`, kind);
  const annotations = decodeAnnotations(object.annotations, `${label}.annotations`, kind);
  const meta = optionalJsonObject(object._meta, `${label}._meta`, kind);
  switch (type) {
    case "text":
      return {
        type: "text",
        text: requireString(object.text, `${label}.text`, kind),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "image":
      return {
        type: "image",
        data: requireString(object.data, `${label}.data`, kind),
        mimeType: requireString(object.mimeType, `${label}.mimeType`, kind),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "audio":
      return {
        type: "audio",
        data: requireString(object.data, `${label}.data`, kind),
        mimeType: requireString(object.mimeType, `${label}.mimeType`, kind),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "resource":
      return {
        type: "resource",
        resource: decodeResourceContents(object.resource, `${label}.resource`, kind),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "resource_link": {
      const icons = decodeIcons(object.icons, `${label}.icons`, kind);
      const title = optionalString(object.title, `${label}.title`, kind);
      const description = optionalString(object.description, `${label}.description`, kind);
      const mimeType = optionalString(object.mimeType, `${label}.mimeType`, kind);
      const size = optionalNumber(object.size, `${label}.size`, kind);
      return {
        type: "resource_link",
        uri: requireString(object.uri, `${label}.uri`, kind),
        name: requireString(object.name, `${label}.name`, kind),
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(mimeType !== undefined ? { mimeType } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(icons ? { icons } : {}),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    }
    default:
      return { type: "unknown", mcpType: type, raw: object };
  }
}

export function decodeContent(
  value: KotaJsonValue | undefined,
  kind: McpResultKind = "tools/call",
): McpToolContentBlock[] {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed MCP ${kind} result: content must be an array`);
  }
  return value.map((entry, index) => decodeMcpContentBlock(entry, index, kind));
}
