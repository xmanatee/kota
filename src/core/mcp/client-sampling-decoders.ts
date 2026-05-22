import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { decodeAnnotations, decodeMcpContentBlock } from "./client-content-decoders.js";
import {
  malformedMcpResult,
  optionalBoolean,
  optionalJsonObject,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requireJsonObject,
  requireString,
} from "./client-decode-utils.js";
import type {
  McpResultKind,
  McpSamplingContentBlock,
  McpSamplingCreateMessageParams,
  McpSamplingCreateMessageResult,
  McpSamplingMessage,
  McpSamplingModelPreferences,
  McpSamplingTool,
  McpSamplingToolChoice,
  McpSamplingToolResultContent,
  McpSamplingToolUseContent,
} from "./client-protocol.js";

export function decodeSamplingContentValue(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): McpSamplingContentBlock | McpSamplingContentBlock[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      decodeSamplingContentBlock(entry, `${label}[${index}]`, kind),
    );
  }
  return decodeSamplingContentBlock(value, label, kind);
}

export function decodeSamplingContentBlock(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): McpSamplingContentBlock {
  const object = optionalJsonObject(value, label, kind);
  if (!object) {
    throw new Error(`Malformed MCP ${kind} result: ${label} must be an object`);
  }
  const type = requireString(object.type, `${label}.type`, kind);
  const annotations = decodeAnnotations(object.annotations, `${label}.annotations`, kind);
  const meta = optionalJsonObject(object._meta, `${label}._meta`, kind);
  if (type === "text") {
    return {
      type: "text",
      text: requireString(object.text, `${label}.text`, kind),
      ...(annotations ? { annotations } : {}),
      ...(meta ? { _meta: meta } : {}),
    };
  }
  if (type === "image") {
    return {
      type: "image",
      data: requireString(object.data, `${label}.data`, kind),
      mimeType: requireString(object.mimeType, `${label}.mimeType`, kind),
      ...(annotations ? { annotations } : {}),
      ...(meta ? { _meta: meta } : {}),
    };
  }
  if (type === "audio") {
    return {
      type: "audio",
      data: requireString(object.data, `${label}.data`, kind),
      mimeType: requireString(object.mimeType, `${label}.mimeType`, kind),
      ...(annotations ? { annotations } : {}),
      ...(meta ? { _meta: meta } : {}),
    };
  }
  if (type === "tool_use") {
    return {
      type: "tool_use",
      id: requireString(object.id, `${label}.id`, kind),
      name: requireString(object.name, `${label}.name`, kind),
      input: requireJsonObject(object.input, `${label}.input`, kind),
      ...(meta ? { _meta: meta } : {}),
    };
  }
  if (type === "tool_result") {
    if (!Array.isArray(object.content)) {
      throw malformedMcpResult(kind, `${label}.content`, "an array");
    }
    const content = object.content.map((entry, index) =>
      decodeMcpContentBlock(entry, `${label}.content[${index}]`, kind),
    );
    if (content.some((block) => block.type === "unknown")) {
      throw new Error(
        `Malformed MCP ${kind} result: ${label}.content includes unsupported content block`,
      );
    }
    const structuredContent = optionalJsonObject(
      object.structuredContent,
      `${label}.structuredContent`,
      kind,
    );
    const isError = optionalBoolean(object.isError, `${label}.isError`, kind);
    return {
      type: "tool_result",
      toolUseId: requireString(object.toolUseId, `${label}.toolUseId`, kind),
      content,
      ...(structuredContent ? { structuredContent } : {}),
      ...(isError !== undefined ? { isError } : {}),
      ...(meta ? { _meta: meta } : {}),
    };
  }
  throw new Error(
    `Malformed MCP ${kind} result: ${label}.type must be text, image, audio, tool_use, or tool_result`,
  );
}

export function samplingContentBlocks(
  content: McpSamplingMessage["content"],
): McpSamplingContentBlock[] {
  return Array.isArray(content) ? content : [content];
}

export function decodeSamplingRole(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): "user" | "assistant" {
  const role = requireString(value, label, kind);
  if (role !== "user" && role !== "assistant") {
    throw new Error(`Malformed MCP ${kind} result: ${label} must be user or assistant`);
  }
  return role;
}

export function decodeSamplingMessage(
  value: KotaJsonValue,
  index: number,
  requestLabel: string,
  kind: McpResultKind,
): McpSamplingMessage {
  const label = `${requestLabel}.params.messages[${index}]`;
  const object = optionalJsonObject(value, label, kind);
  if (!object) {
    throw new Error(`Malformed MCP ${kind} result: ${label} must be an object`);
  }
  const meta = optionalJsonObject(object._meta, `${label}._meta`, kind);
  return {
    role: decodeSamplingRole(object.role, `${label}.role`, kind),
    content: decodeSamplingContentValue(object.content, `${label}.content`, kind),
    ...(meta ? { _meta: meta } : {}),
  };
}

export function validateSamplingMessages(
  messages: McpSamplingMessage[],
  requestLabel: string,
  kind: McpResultKind,
): void {
  let pendingToolUseIds: string[] = [];
  for (const [index, message] of messages.entries()) {
    const label = `${requestLabel}.params.messages[${index}]`;
    const blocks = samplingContentBlocks(message.content);
    const toolResults = blocks.filter(
      (block): block is McpSamplingToolResultContent => block.type === "tool_result",
    );
    const toolUses = blocks.filter(
      (block): block is McpSamplingToolUseContent => block.type === "tool_use",
    );

    if (toolResults.length > 0) {
      if (message.role !== "user") {
        throw new Error(
          `Malformed MCP ${kind} result: ${label}.role must be user when content contains tool_result blocks`,
        );
      }
      if (toolResults.length !== blocks.length) {
        throw new Error(
          `Malformed MCP ${kind} result: ${label}.content must contain only tool_result blocks`,
        );
      }
    }
    if (toolUses.length > 0 && message.role !== "assistant") {
      throw new Error(
        `Malformed MCP ${kind} result: ${label}.role must be assistant when content contains tool_use blocks`,
      );
    }

    if (pendingToolUseIds.length > 0) {
      const resultIds = new Set(toolResults.map((block) => block.toolUseId));
      const missing = pendingToolUseIds.filter((id) => !resultIds.has(id));
      if (message.role !== "user" || toolResults.length !== blocks.length || missing.length > 0) {
        throw new Error(
          `Malformed MCP ${kind} result: ${label} must answer pending tool_use ids ${pendingToolUseIds.join(", ")} before normal conversation continues`,
        );
      }
      const extras = [...resultIds].filter((id) => !pendingToolUseIds.includes(id));
      if (extras.length > 0) {
        throw new Error(
          `Malformed MCP ${kind} result: ${label}.content has tool_result ids without matching pending tool_use ids ${extras.join(", ")}`,
        );
      }
      pendingToolUseIds = [];
      continue;
    }

    if (toolResults.length > 0) {
      throw new Error(
        `Malformed MCP ${kind} result: ${label}.content has tool_result blocks without a preceding assistant tool_use message`,
      );
    }
    if (toolUses.length > 0) {
      pendingToolUseIds = toolUses.map((block) => block.id);
    }
  }

  if (pendingToolUseIds.length > 0) {
    throw new Error(
      `Malformed MCP ${kind} result: ${requestLabel}.params.messages must answer pending tool_use ids ${pendingToolUseIds.join(", ")}`,
    );
  }
}

export function decodeSamplingModelPreferences(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): McpSamplingModelPreferences | undefined {
  const object = optionalJsonObject(value, label, kind);
  if (!object) return undefined;
  const hints = object.hints === undefined
    ? undefined
    : Array.isArray(object.hints)
      ? object.hints.map((hint, index) => {
        const hintObject = optionalJsonObject(hint, `${label}.hints[${index}]`, kind);
        if (!hintObject) {
          throw malformedMcpResult(kind, `${label}.hints[${index}]`, "an object");
        }
        const name = optionalString(hintObject.name, `${label}.hints[${index}].name`, kind);
        return name === undefined ? {} : { name };
      })
      : null;
  if (hints === null) {
    throw malformedMcpResult(kind, `${label}.hints`, "an array");
  }
  const costPriority = optionalNumber(object.costPriority, `${label}.costPriority`, kind);
  const speedPriority = optionalNumber(object.speedPriority, `${label}.speedPriority`, kind);
  const intelligencePriority = optionalNumber(
    object.intelligencePriority,
    `${label}.intelligencePriority`,
    kind,
  );
  return {
    ...(hints !== undefined ? { hints } : {}),
    ...(costPriority !== undefined ? { costPriority } : {}),
    ...(speedPriority !== undefined ? { speedPriority } : {}),
    ...(intelligencePriority !== undefined ? { intelligencePriority } : {}),
  };
}

export function decodeSamplingTool(
  value: KotaJsonValue,
  index: number,
  label: string,
  kind: McpResultKind,
): McpSamplingTool {
  const toolLabel = `${label}[${index}]`;
  const object = optionalJsonObject(value, toolLabel, kind);
  if (!object) {
    throw malformedMcpResult(kind, toolLabel, "an object");
  }
  const inputSchema = requireJsonObject(object.inputSchema, `${toolLabel}.inputSchema`, kind);
  if (inputSchema.type !== "object") {
    throw new Error(`Malformed MCP ${kind} result: ${toolLabel}.inputSchema.type must be object`);
  }
  const outputSchema = object.outputSchema === undefined
    ? undefined
    : requireJsonObject(object.outputSchema, `${toolLabel}.outputSchema`, kind);
  if (outputSchema !== undefined && outputSchema.type !== "object") {
    throw new Error(`Malformed MCP ${kind} result: ${toolLabel}.outputSchema.type must be object`);
  }
  const description = optionalString(object.description, `${toolLabel}.description`, kind);
  return {
    name: requireString(object.name, `${toolLabel}.name`, kind),
    ...(description !== undefined ? { description } : {}),
    inputSchema: inputSchema as McpSamplingTool["inputSchema"],
    ...(outputSchema !== undefined
      ? { outputSchema: outputSchema as McpSamplingTool["outputSchema"] }
      : {}),
  };
}

export function decodeSamplingToolChoice(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): McpSamplingToolChoice | undefined {
  const object = optionalJsonObject(value, label, kind);
  if (!object) return undefined;
  const mode = optionalString(object.mode, `${label}.mode`, kind);
  if (mode !== undefined && mode !== "none" && mode !== "required" && mode !== "auto") {
    throw new Error(
      `Malformed MCP ${kind} result: ${label}.mode must be none, required, or auto`,
    );
  }
  return mode === undefined ? {} : { mode };
}

export function decodeSamplingCreateMessageParams(
  value: KotaJsonValue | undefined,
  requestLabel: string,
  kind: McpResultKind,
): McpSamplingCreateMessageParams {
  const object = requireJsonObject(value, `${requestLabel}.params`, kind);
  if (!Array.isArray(object.messages) || object.messages.length === 0) {
    throw malformedMcpResult(kind, `${requestLabel}.params.messages`, "a non-empty array");
  }
  const messages = object.messages.map((entry, index) =>
    decodeSamplingMessage(entry, index, requestLabel, kind),
  );
  validateSamplingMessages(messages, requestLabel, kind);
  const includeContext = optionalString(object.includeContext, `${requestLabel}.params.includeContext`, kind);
  if (
    includeContext !== undefined &&
    includeContext !== "none" &&
    includeContext !== "thisServer" &&
    includeContext !== "allServers"
  ) {
    throw new Error(
      `Malformed MCP ${kind} result: ${requestLabel}.params.includeContext must be none, thisServer, or allServers`,
    );
  }
  const stopSequences = optionalStringArray(
    object.stopSequences,
    `${requestLabel}.params.stopSequences`,
    kind,
  );
  const tools = object.tools === undefined
    ? undefined
    : Array.isArray(object.tools)
      ? object.tools.map((entry, index) =>
        decodeSamplingTool(entry, index, `${requestLabel}.params.tools`, kind),
      )
      : null;
  if (tools === null) {
    throw malformedMcpResult(kind, `${requestLabel}.params.tools`, "an array");
  }
  const meta = optionalJsonObject(object._meta, `${requestLabel}.params._meta`, kind);
  const metadata = optionalJsonObject(object.metadata, `${requestLabel}.params.metadata`, kind);
  const modelPreferences = decodeSamplingModelPreferences(
    object.modelPreferences,
    `${requestLabel}.params.modelPreferences`,
    kind,
  );
  const toolChoice = decodeSamplingToolChoice(
    object.toolChoice,
    `${requestLabel}.params.toolChoice`,
    kind,
  );
  const systemPrompt = optionalString(object.systemPrompt, `${requestLabel}.params.systemPrompt`, kind);
  const temperature = optionalNumber(object.temperature, `${requestLabel}.params.temperature`, kind);
  const maxTokens = optionalNumber(object.maxTokens, `${requestLabel}.params.maxTokens`, kind);
  if (maxTokens === undefined) {
    throw malformedMcpResult(kind, `${requestLabel}.params.maxTokens`, "a number");
  }
  return {
    messages,
    ...(modelPreferences !== undefined ? { modelPreferences } : {}),
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    ...(includeContext !== undefined
      ? { includeContext: includeContext as "none" | "thisServer" | "allServers" }
      : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    maxTokens,
    ...(stopSequences !== undefined ? { stopSequences } : {}),
    ...(metadata ? { metadata } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(toolChoice !== undefined ? { toolChoice } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

export function decodeSamplingCreateMessageResult(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): McpSamplingCreateMessageResult {
  const object = requireJsonObject(value, label, kind);
  const stopReason = optionalString(object.stopReason, `${label}.stopReason`, kind);
  const meta = optionalJsonObject(object._meta, `${label}._meta`, kind);
  return {
    role: decodeSamplingRole(object.role, `${label}.role`, kind),
    content: decodeSamplingContentValue(object.content, `${label}.content`, kind),
    model: requireString(object.model, `${label}.model`, kind),
    ...(stopReason !== undefined ? { stopReason } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}
