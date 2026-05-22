import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { decodeAnnotations, decodeIcons } from "./client-content-decoders.js";
import {
  decodeCacheHints,
  malformedMcpResult,
  optionalBoolean,
  optionalJsonObject,
  optionalNumber,
  optionalString,
  requireJsonObject,
  requireString,
} from "./client-decode-utils.js";
import type {
  JsonRpcResponse,
  McpListPromptsPage,
  McpListResourcesPage,
  McpListResourceTemplatesPage,
  McpPromptArgumentSchema,
  McpPromptSchema,
  McpResourceSchema,
  McpResourceTemplateSchema,
} from "./client-protocol.js";

export function decodeResourceDefinition(
  value: KotaJsonValue,
  index: number,
): McpResourceSchema {
  const label = `resources[${index}]`;
  const object = optionalJsonObject(value, label, "resources/list");
  if (!object) {
    throw malformedMcpResult("resources/list", label, "an object");
  }
  const title = optionalString(object.title, `${label}.title`, "resources/list");
  const description = optionalString(
    object.description,
    `${label}.description`,
    "resources/list",
  );
  const mimeType = optionalString(object.mimeType, `${label}.mimeType`, "resources/list");
  const annotations = decodeAnnotations(
    object.annotations,
    `${label}.annotations`,
    "resources/list",
  );
  const size = optionalNumber(object.size, `${label}.size`, "resources/list");
  const icons = decodeIcons(object.icons, `${label}.icons`, "resources/list");
  const meta = optionalJsonObject(object._meta, `${label}._meta`, "resources/list");
  return {
    uri: requireString(object.uri, `${label}.uri`, "resources/list"),
    name: requireString(object.name, `${label}.name`, "resources/list"),
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(annotations ? { annotations } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(icons ? { icons } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

export function decodeListResourcesResult(value: JsonRpcResponse["result"]): McpListResourcesPage {
  const object = requireJsonObject(value, "result", "resources/list");
  if (!Array.isArray(object.resources)) {
    throw malformedMcpResult("resources/list", "resources", "an array");
  }
  const nextCursor = optionalString(object.nextCursor, "nextCursor", "resources/list");
  return {
    resources: object.resources.map(decodeResourceDefinition),
    cache: decodeCacheHints(object, "resources/list"),
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}

export function decodeResourceTemplateDefinition(
  value: KotaJsonValue,
  index: number,
): McpResourceTemplateSchema {
  const label = `resourceTemplates[${index}]`;
  const object = optionalJsonObject(value, label, "resources/templates/list");
  if (!object) {
    throw malformedMcpResult("resources/templates/list", label, "an object");
  }
  const title = optionalString(
    object.title,
    `${label}.title`,
    "resources/templates/list",
  );
  const description = optionalString(
    object.description,
    `${label}.description`,
    "resources/templates/list",
  );
  const mimeType = optionalString(
    object.mimeType,
    `${label}.mimeType`,
    "resources/templates/list",
  );
  const annotations = decodeAnnotations(
    object.annotations,
    `${label}.annotations`,
    "resources/templates/list",
  );
  const icons = decodeIcons(object.icons, `${label}.icons`, "resources/templates/list");
  const meta = optionalJsonObject(object._meta, `${label}._meta`, "resources/templates/list");
  return {
    uriTemplate: requireString(
      object.uriTemplate,
      `${label}.uriTemplate`,
      "resources/templates/list",
    ),
    name: requireString(object.name, `${label}.name`, "resources/templates/list"),
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(annotations ? { annotations } : {}),
    ...(icons ? { icons } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

export function decodeListResourceTemplatesResult(
  value: JsonRpcResponse["result"],
): McpListResourceTemplatesPage {
  const object = requireJsonObject(value, "result", "resources/templates/list");
  if (!Array.isArray(object.resourceTemplates)) {
    throw malformedMcpResult(
      "resources/templates/list",
      "resourceTemplates",
      "an array",
    );
  }
  const nextCursor = optionalString(
    object.nextCursor,
    "nextCursor",
    "resources/templates/list",
  );
  return {
    resourceTemplates: object.resourceTemplates.map(decodeResourceTemplateDefinition),
    cache: decodeCacheHints(object, "resources/templates/list"),
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}

export function decodePromptArgumentDefinition(
  value: KotaJsonValue,
  index: number,
): McpPromptArgumentSchema {
  const label = `arguments[${index}]`;
  const object = optionalJsonObject(value, label, "prompts/list");
  if (!object) {
    throw malformedMcpResult("prompts/list", label, "an object");
  }
  const title = optionalString(object.title, `${label}.title`, "prompts/list");
  const description = optionalString(object.description, `${label}.description`, "prompts/list");
  const required = optionalBoolean(object.required, `${label}.required`, "prompts/list");
  const meta = optionalJsonObject(object._meta, `${label}._meta`, "prompts/list");
  return {
    name: requireString(object.name, `${label}.name`, "prompts/list"),
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(required !== undefined ? { required } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

export function decodePromptDefinition(value: KotaJsonValue, index: number): McpPromptSchema {
  const label = `prompts[${index}]`;
  const object = optionalJsonObject(value, label, "prompts/list");
  if (!object) {
    throw malformedMcpResult("prompts/list", label, "an object");
  }
  const title = optionalString(object.title, `${label}.title`, "prompts/list");
  const description = optionalString(object.description, `${label}.description`, "prompts/list");
  const args = object.arguments === undefined
    ? undefined
    : Array.isArray(object.arguments)
      ? object.arguments.map(decodePromptArgumentDefinition)
      : null;
  if (args === null) {
    throw malformedMcpResult("prompts/list", `${label}.arguments`, "an array");
  }
  const meta = optionalJsonObject(object._meta, `${label}._meta`, "prompts/list");
  return {
    name: requireString(object.name, `${label}.name`, "prompts/list"),
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(args !== undefined ? { arguments: args } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

export function decodeListPromptsResult(value: JsonRpcResponse["result"]): McpListPromptsPage {
  const object = requireJsonObject(value, "result", "prompts/list");
  if (!Array.isArray(object.prompts)) {
    throw malformedMcpResult("prompts/list", "prompts", "an array");
  }
  const nextCursor = optionalString(object.nextCursor, "nextCursor", "prompts/list");
  return {
    prompts: object.prompts.map(decodePromptDefinition),
    cache: decodeCacheHints(object, "prompts/list"),
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}
