import type {
  KotaContentBlock,
  KotaJsonValue,
  KotaMessage,
  KotaToolResultContentBlock,
} from "./message-protocol.js";

export class KotaMessageDecodeError extends Error {
  constructor(readonly location: string, message: string) {
    super(`Invalid KOTA message at ${location}: ${message}`);
    this.name = "KotaMessageDecodeError";
  }
}

export function decodeKotaMessages(value: unknown, location = "messages"): KotaMessage[] {
  if (!Array.isArray(value)) throw new KotaMessageDecodeError(location, "expected an array");
  return value.map((message, index) => decodeKotaMessage(message, `${location}[${index}]`));
}

export function decodeKotaMessage(value: unknown, location = "message"): KotaMessage {
  const message = requireObject(value, location);
  if (message.role !== "user" && message.role !== "assistant") {
    throw new KotaMessageDecodeError(`${location}.role`, "expected user or assistant");
  }
  const content = typeof message.content === "string"
    ? message.content
    : decodeContentBlocks(message.content, `${location}.content`);
  return { role: message.role, content };
}

function decodeContentBlocks(value: unknown, location: string): KotaContentBlock[] {
  if (!Array.isArray(value)) {
    throw new KotaMessageDecodeError(location, "expected text or a content-block array");
  }
  return value.map((block, index) => decodeContentBlock(block, `${location}[${index}]`));
}

function decodeContentBlock(value: unknown, location: string): KotaContentBlock {
  const block = requireObject(value, location);
  switch (block.type) {
    case "text":
      requireString(block.text, `${location}.text`);
      validateOptionalJsonObject(block._meta, `${location}._meta`);
      validateOptionalAnnotations(block.annotations, `${location}.annotations`);
      if (block.cache_control !== undefined) {
        const cache = requireObject(block.cache_control, `${location}.cache_control`);
        if (cache.type !== "ephemeral") {
          throw new KotaMessageDecodeError(`${location}.cache_control.type`, "expected ephemeral");
        }
      }
      return block as KotaContentBlock;
    case "tool_use":
      requireString(block.id, `${location}.id`);
      requireString(block.name, `${location}.name`);
      if (!("input" in block)) {
        throw new KotaMessageDecodeError(`${location}.input`, "field is required");
      }
      if (!isJsonValue(block.input)) {
        throw new KotaMessageDecodeError(`${location}.input`, "expected a JSON value");
      }
      return block as KotaContentBlock;
    case "tool_result":
      requireString(block.tool_use_id, `${location}.tool_use_id`);
      decodeToolResultContent(block.content, `${location}.content`);
      validateOptionalJsonObject(block.structuredContent, `${location}.structuredContent`);
      validateOptionalJsonObject(block._meta, `${location}._meta`);
      if (block.is_error !== undefined && typeof block.is_error !== "boolean") {
        throw new KotaMessageDecodeError(`${location}.is_error`, "expected a boolean");
      }
      return block as KotaContentBlock;
    case "image": {
      const source = requireObject(block.source, `${location}.source`);
      if (source.type !== "base64") {
        throw new KotaMessageDecodeError(`${location}.source.type`, "expected base64");
      }
      requireString(source.media_type, `${location}.source.media_type`);
      requireString(source.data, `${location}.source.data`);
      validateOptionalJsonObject(block._meta, `${location}._meta`);
      validateOptionalAnnotations(block.annotations, `${location}.annotations`);
      return block as KotaContentBlock;
    }
    case "thinking":
      requireString(block.thinking, `${location}.thinking`);
      requireString(block.signature, `${location}.signature`);
      return block as KotaContentBlock;
    default:
      throw new KotaMessageDecodeError(`${location}.type`, `unsupported block ${String(block.type)}`);
  }
}

function decodeToolResultContent(
  value: unknown,
  location: string,
): string | KotaToolResultContentBlock[] {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) {
    throw new KotaMessageDecodeError(location, "expected text or a result-block array");
  }
  return value.map((block, index) => {
    const decoded = decodeContentBlock(block, `${location}[${index}]`);
    if (decoded.type !== "text" && decoded.type !== "image") {
      throw new KotaMessageDecodeError(
        `${location}[${index}].type`,
        "tool results may contain only text or image blocks",
      );
    }
    return decoded;
  });
}

function validateOptionalAnnotations(value: unknown, location: string): void {
  if (value === undefined) return;
  const annotations = requireObject(value, location);
  if (annotations.audience !== undefined) {
    if (
      !Array.isArray(annotations.audience) ||
      !annotations.audience.every((role) => role === "user" || role === "assistant")
    ) {
      throw new KotaMessageDecodeError(`${location}.audience`, "expected message roles");
    }
  }
  if (annotations.priority !== undefined && typeof annotations.priority !== "number") {
    throw new KotaMessageDecodeError(`${location}.priority`, "expected a number");
  }
  if (annotations.lastModified !== undefined) {
    requireString(annotations.lastModified, `${location}.lastModified`);
  }
}

function validateOptionalJsonObject(value: unknown, location: string): void {
  if (value === undefined) return;
  if (!isJsonValue(value) || Array.isArray(value) || value === null || typeof value !== "object") {
    throw new KotaMessageDecodeError(location, "expected a JSON object");
  }
}

function requireObject(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new KotaMessageDecodeError(location, "expected an object");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, location: string): asserts value is string {
  if (typeof value !== "string") throw new KotaMessageDecodeError(location, "expected a string");
}

function isJsonValue(value: unknown): value is KotaJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
}
