import { Buffer } from "node:buffer";
import type { KotaJsonObject, KotaJsonValue, KotaToolInputSchema } from "#core/agent-harness/message-protocol.js";
import type { McpToolAnnotations } from "#core/tools/effect.js";
import {
  decodeCacheHints,
  isJsonObject,
  malformedMcpResult,
  optionalJsonObject,
  optionalString,
  optionalStringArray,
  requireJsonObject,
  requireString,
} from "./client-decode-utils.js";
import type {
  JsonRpcResponse,
  McpHeaderParameterSpec,
  McpListToolsPage,
  McpRejectedToolDefinition,
  McpToolSchema,
} from "./client-protocol.js";
import { MCP_HEADER_ANNOTATION } from "./client-protocol.js";

export class McpHeaderAnnotationError extends Error {
  constructor(
    readonly reason: string,
    readonly toolName: string,
  ) {
    super(reason);
  }
}


export function decodeToolObjectSchema(
  value: KotaJsonValue | undefined,
  label: string,
): KotaToolInputSchema {
  const object = optionalJsonObject(value, label, "tools/list");
  if (!object) {
    throw malformedMcpResult("tools/list", label, "an object");
  }
  const type = requireString(object.type, `${label}.type`, "tools/list");
  if (type !== "object") {
    throw new Error(`Malformed MCP tools/list result: ${label}.type must be "object"`);
  }
  const properties = optionalJsonObject(
    object.properties,
    `${label}.properties`,
    "tools/list",
  ) ?? {};
  const required = optionalStringArray(
    object.required,
    `${label}.required`,
    "tools/list",
  );
  return {
    ...object,
    type: "object",
    properties,
    ...(required !== undefined ? { required } : {}),
  };
}

export function isPrimitiveHeaderPropertyType(value: KotaJsonValue | undefined): boolean {
  return value === "string" || value === "number" || value === "boolean";
}

export function isAllowedHeaderAnnotationValue(value: string): boolean {
  if (value.length === 0) return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x21 || code > 0x7e || char === ":") return false;
  }
  return true;
}

export function schemaPropertyLabel(parentLabel: string, propertyName: string): string {
  return `${parentLabel}.properties.${propertyName}`;
}

export function rejectHeaderAnnotation(
  toolName: string,
  propertyLabel: string,
  reason: string,
): never {
  throw new McpHeaderAnnotationError(
    `${propertyLabel}.${MCP_HEADER_ANNOTATION} ${reason}`,
    toolName,
  );
}

export function validateHeaderAnnotationValue(args: {
  toolName: string;
  propertyLabel: string;
  propertySchema: KotaJsonObject;
  seenHeaders: Map<string, { value: string; propertyLabel: string }>;
}): void {
  const headerValue = args.propertySchema[MCP_HEADER_ANNOTATION];
  if (headerValue === undefined) return;
  if (!isPrimitiveHeaderPropertyType(args.propertySchema.type)) {
    rejectHeaderAnnotation(
      args.toolName,
      args.propertyLabel,
      "is only allowed on primitive string, number, or boolean properties",
    );
  }
  if (typeof headerValue !== "string") {
    rejectHeaderAnnotation(
      args.toolName,
      args.propertyLabel,
      "must be a non-empty ASCII header string",
    );
  }
  if (headerValue.length === 0) {
    rejectHeaderAnnotation(args.toolName, args.propertyLabel, "has empty value");
  }
  if (!isAllowedHeaderAnnotationValue(headerValue)) {
    rejectHeaderAnnotation(
      args.toolName,
      args.propertyLabel,
      'contains a forbidden character; use non-empty printable ASCII without spaces or ":"',
    );
  }
  const normalized = headerValue.toLowerCase();
  const duplicate = args.seenHeaders.get(normalized);
  if (duplicate) {
    rejectHeaderAnnotation(
      args.toolName,
      args.propertyLabel,
      `duplicates header "${duplicate.value}" from ${duplicate.propertyLabel} case-insensitively`,
    );
  }
  args.seenHeaders.set(normalized, {
    value: headerValue,
    propertyLabel: args.propertyLabel,
  });
}

export function validateMcpHeaderAnnotationsInProperties(args: {
  toolName: string;
  parentLabel: string;
  properties: KotaJsonObject;
  seenHeaders: Map<string, { value: string; propertyLabel: string }>;
}): void {
  for (const [propertyName, rawPropertySchema] of Object.entries(args.properties)) {
    if (!isJsonObject(rawPropertySchema)) continue;
    const propertyLabel = schemaPropertyLabel(args.parentLabel, propertyName);
    validateHeaderAnnotationValue({
      toolName: args.toolName,
      propertyLabel,
      propertySchema: rawPropertySchema,
      seenHeaders: args.seenHeaders,
    });
    const nestedProperties = rawPropertySchema.properties;
    if (isJsonObject(nestedProperties)) {
      validateMcpHeaderAnnotationsInProperties({
        toolName: args.toolName,
        parentLabel: propertyLabel,
        properties: nestedProperties,
        seenHeaders: args.seenHeaders,
      });
    }
  }
}

export function validateMcpHeaderAnnotations(
  toolName: string,
  inputSchema: KotaToolInputSchema,
  label: string,
): void {
  const properties = isJsonObject(inputSchema.properties)
    ? inputSchema.properties
    : {};
  validateMcpHeaderAnnotationsInProperties({
    toolName,
    parentLabel: label,
    properties,
    seenHeaders: new Map(),
  });
}

export function collectMcpHeaderParameters(tool: McpToolSchema): McpHeaderParameterSpec[] {
  const specs: McpHeaderParameterSpec[] = [];
  for (const [paramName, rawPropertySchema] of Object.entries(tool.inputSchema.properties)) {
    if (!isJsonObject(rawPropertySchema)) continue;
    const headerName = rawPropertySchema[MCP_HEADER_ANNOTATION];
    if (typeof headerName !== "string") continue;
    if (!isPrimitiveHeaderPropertyType(rawPropertySchema.type)) continue;
    specs.push({ paramName, headerName });
  }
  return specs;
}

function optionalBooleanAnnotation(
  object: KotaJsonObject,
  field: keyof McpToolAnnotations,
): boolean | undefined {
  return typeof object[field] === "boolean" ? object[field] : undefined;
}

export function decodeToolAnnotations(
  value: KotaJsonValue | undefined,
): McpToolAnnotations | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) return undefined;
  const readOnlyHint = optionalBooleanAnnotation(value, "readOnlyHint");
  const destructiveHint = optionalBooleanAnnotation(value, "destructiveHint");
  const openWorldHint = optionalBooleanAnnotation(value, "openWorldHint");
  const idempotentHint = optionalBooleanAnnotation(value, "idempotentHint");
  if (
    readOnlyHint === undefined &&
    destructiveHint === undefined &&
    openWorldHint === undefined &&
    idempotentHint === undefined
  ) {
    return undefined;
  }
  return {
    ...(readOnlyHint !== undefined ? { readOnlyHint } : {}),
    ...(destructiveHint !== undefined ? { destructiveHint } : {}),
    ...(openWorldHint !== undefined ? { openWorldHint } : {}),
    ...(idempotentHint !== undefined ? { idempotentHint } : {}),
  };
}

export function decodeToolDefinition(value: KotaJsonValue, index: number): McpToolSchema {
  const label = `tools[${index}]`;
  const object = optionalJsonObject(value, label, "tools/list");
  if (!object) {
    throw malformedMcpResult("tools/list", label, "an object");
  }
  const name = requireString(object.name, `${label}.name`, "tools/list");
  const inputSchema = decodeToolObjectSchema(object.inputSchema, `${label}.inputSchema`);
  validateMcpHeaderAnnotations(name, inputSchema, `${label}.inputSchema`);
  const outputSchema = object.outputSchema === undefined
    ? undefined
    : decodeToolObjectSchema(object.outputSchema, `${label}.outputSchema`);
  const annotations = decodeToolAnnotations(object.annotations);
  return {
    name,
    ...(object.description !== undefined
      ? { description: optionalString(object.description, `${label}.description`, "tools/list") }
      : {}),
    inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
    ...(annotations ? { annotations } : {}),
  };
}

export function decodeListToolsResult(value: JsonRpcResponse["result"]): McpListToolsPage {
  const object = requireJsonObject(value, "result", "tools/list");
  const tools = object.tools;
  if (!Array.isArray(tools)) {
    throw malformedMcpResult("tools/list", "tools", "an array");
  }
  const nextCursor = optionalString(object.nextCursor, "nextCursor", "tools/list");
  const decodedTools: McpToolSchema[] = [];
  const rejectedTools: McpRejectedToolDefinition[] = [];
  for (const [index, rawTool] of tools.entries()) {
    try {
      decodedTools.push(decodeToolDefinition(rawTool, index));
    } catch (err) {
      if (err instanceof McpHeaderAnnotationError) {
        rejectedTools.push({
          toolName: err.toolName,
          reason: err.reason,
        });
        continue;
      }
      throw err;
    }
  }
  return {
    tools: decodedTools,
    rejectedTools,
    cache: decodeCacheHints(object, "tools/list"),
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}

export function warnRejectedTool(serverName: string, rejected: McpRejectedToolDefinition): void {
  const toolLabel = rejected.toolName
    ? `tool "${rejected.toolName}"`
    : "tool definition";
  console.error(
    `[kota] Warning: rejected MCP ${toolLabel} from server "${serverName}": ${rejected.reason}`,
  );
}

export function isPlainMcpParamHeaderValue(value: string): boolean {
  if (value.length === 0 || value.trim() !== value) return false;
  if (value.startsWith("=?base64?") && value.endsWith("?=")) return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code !== 0x09 && (code < 0x20 || code > 0x7e)) return false;
  }
  return true;
}

export function mcpParamHeaderValue(value: KotaJsonValue | undefined): string | null {
  let raw: string;
  if (typeof value === "string") {
    raw = value;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    raw = String(value);
  } else if (typeof value === "boolean") {
    raw = value ? "true" : "false";
  } else {
    return null;
  }
  if (isPlainMcpParamHeaderValue(raw)) return raw;
  return `=?base64?${Buffer.from(raw, "utf8").toString("base64")}?=`;
}
