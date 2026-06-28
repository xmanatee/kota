import type { KotaAgentMessage, KotaContentBlock, KotaToolResultBlock } from "#core/agent-harness/index.js";
import { TRAJECTORY_TOOL_RESULT_CONTENT_LIMIT } from "./runner-constants.js";
import {
  type SanitizedJsonObject,
  sanitizeJsonObject,
  truncateField,
  truncateStringField,
} from "./runner-trajectory-json.js";
import type { HarnessParityTrajectoryCounts, HarnessParityTrajectoryFrame } from "./runner-types.js";

type SanitizedTrajectoryMessage = {
  message: KotaAgentMessage;
  truncatedFields: string[];
};
type KotaToolResultRichContentBlock = Exclude<
  KotaToolResultBlock["content"],
  string
>[number];

type SanitizedTrajectoryBlock = { block: KotaContentBlock; truncatedFields: string[] };

type SanitizedToolResultRichContentBlock = {
  block: KotaToolResultRichContentBlock;
  truncatedFields: string[];
};

function sanitizeTextBlock(
  block: Extract<KotaContentBlock, { type: "text" }>,
  path: string,
): {
  block: Extract<KotaContentBlock, { type: "text" }>;
  truncatedFields: string[];
} {
  const text = truncateStringField(block.text, `${path}.text`);
  return {
    block: { ...block, text: text.value },
    truncatedFields: text.truncatedFields,
  };
}

function sanitizeImageBlock(
  block: Extract<KotaContentBlock, { type: "image" }>,
  path: string,
): {
  block: Extract<KotaContentBlock, { type: "image" }>;
  truncatedFields: string[];
} {
  const data = truncateStringField(block.source.data, `${path}.source.data`);
  return {
    block: {
      ...block,
      source: { ...block.source, data: data.value },
    },
    truncatedFields: data.truncatedFields,
  };
}

function sanitizeThinkingBlock(
  block: Extract<KotaContentBlock, { type: "thinking" }>,
  path: string,
): {
  block: Extract<KotaContentBlock, { type: "thinking" }>;
  truncatedFields: string[];
} {
  const thinking = truncateStringField(block.thinking, `${path}.thinking`);
  return {
    block: { ...block, thinking: thinking.value },
    truncatedFields: thinking.truncatedFields,
  };
}

function sanitizeMcpContentBlock(
  block: Extract<KotaToolResultRichContentBlock, { type: "mcp_content" }>,
  path: string,
): {
  block: Extract<KotaToolResultRichContentBlock, { type: "mcp_content" }>;
  truncatedFields: string[];
} {
  const mcpContent = block.content;
  if (mcpContent.type === "audio") {
    const data = truncateStringField(mcpContent.data, `${path}.content.data`);
    return {
      block: { ...block, content: { ...mcpContent, data: data.value } },
      truncatedFields: data.truncatedFields,
    };
  }
  if (mcpContent.type === "resource") {
    if ("text" in mcpContent.resource) {
      const text = truncateStringField(
        mcpContent.resource.text,
        `${path}.content.resource.text`,
      );
      return {
        block: {
          ...block,
          content: {
            ...mcpContent,
            resource: { ...mcpContent.resource, text: text.value },
          },
        },
        truncatedFields: text.truncatedFields,
      };
    }
    const blob = truncateStringField(
      mcpContent.resource.blob,
      `${path}.content.resource.blob`,
    );
    return {
      block: {
        ...block,
        content: {
          ...mcpContent,
          resource: { ...mcpContent.resource, blob: blob.value },
        },
      },
      truncatedFields: blob.truncatedFields,
    };
  }
  if (mcpContent.type === "unknown") {
    const raw = sanitizeJsonObject(mcpContent.raw, `${path}.content.raw`);
    return {
      block: { ...block, content: { ...mcpContent, raw: raw.value } },
      truncatedFields: raw.truncatedFields,
    };
  }
  return { block, truncatedFields: [] };
}

function sanitizeToolResultRichContentBlock(
  block: KotaToolResultRichContentBlock,
  path: string,
): SanitizedToolResultRichContentBlock {
  if (block.type === "text") return sanitizeTextBlock(block, path);
  if (block.type === "image") return sanitizeImageBlock(block, path);
  return sanitizeMcpContentBlock(block, path);
}

function sanitizeNestedToolResultBlock(
  block: Extract<KotaContentBlock, { type: "tool_result" }>,
  path: string,
): {
  block: Extract<KotaContentBlock, { type: "tool_result" }>;
  truncatedFields: string[];
} {
  const truncatedFields: string[] = [];
  const content = block.content;
  let sanitizedContent: KotaToolResultBlock["content"];
  if (typeof content === "string") {
    const sanitized = truncateStringField(content, `${path}.content`);
    truncatedFields.push(...sanitized.truncatedFields);
    sanitizedContent = sanitized.value;
  } else {
    const sanitizedBlocks: KotaToolResultRichContentBlock[] = [];
    for (const [index, contentBlock] of content.entries()) {
      const sanitized = sanitizeToolResultRichContentBlock(
        contentBlock,
        `${path}.content[${index}]`,
      );
      sanitizedBlocks.push(sanitized.block);
      truncatedFields.push(...sanitized.truncatedFields);
    }
    sanitizedContent = sanitizedBlocks;
  }

  let sanitizedStructuredContent: SanitizedJsonObject | undefined;
  if (block.structuredContent !== undefined) {
    sanitizedStructuredContent = sanitizeJsonObject(
      block.structuredContent,
      `${path}.structuredContent`,
    );
  }
  let sanitizedMeta: SanitizedJsonObject | undefined;
  if (block._meta !== undefined) {
    sanitizedMeta = sanitizeJsonObject(block._meta, `${path}._meta`);
  }
  if (sanitizedStructuredContent !== undefined) {
    truncatedFields.push(...sanitizedStructuredContent.truncatedFields);
  }
  if (sanitizedMeta !== undefined) {
    truncatedFields.push(...sanitizedMeta.truncatedFields);
  }

  return {
    block: {
      ...block,
      content: sanitizedContent,
      ...(sanitizedStructuredContent !== undefined
        ? { structuredContent: sanitizedStructuredContent.value }
        : {}),
      ...(sanitizedMeta !== undefined ? { _meta: sanitizedMeta.value } : {}),
    },
    truncatedFields,
  };
}

function sanitizeTrajectoryContentBlock(
  block: KotaContentBlock,
  path: string,
): SanitizedTrajectoryBlock {
  if (block.type === "text") return sanitizeTextBlock(block, path);
  if (block.type === "image") return sanitizeImageBlock(block, path);
  if (block.type === "tool_result") {
    return sanitizeNestedToolResultBlock(block, path);
  }
  if (block.type === "thinking") return sanitizeThinkingBlock(block, path);
  return { block, truncatedFields: [] };
}

function sanitizeToolResultMessage(
  message: Extract<KotaAgentMessage, { type: "tool_result" }>,
): SanitizedTrajectoryMessage {
  const truncatedFields: string[] = [];
  if (typeof message.content === "string") {
    const content = truncateField(
      message.content,
      TRAJECTORY_TOOL_RESULT_CONTENT_LIMIT,
    );
    if (content.truncated) truncatedFields.push("content");
    return {
      message: { ...message, content: content.value },
      truncatedFields,
    };
  }

  const content: KotaContentBlock[] = [];
  for (const [index, block] of message.content.entries()) {
    const sanitized = sanitizeTrajectoryContentBlock(
      block,
      `content[${index}]`,
    );
    content.push(sanitized.block);
    truncatedFields.push(...sanitized.truncatedFields);
  }
  return {
    message: { ...message, content },
    truncatedFields,
  };
}

function sanitizeTrajectoryMessage(
  message: KotaAgentMessage,
): SanitizedTrajectoryMessage {
  if (message.type === "tool_result") return sanitizeToolResultMessage(message);
  return { message, truncatedFields: [] };
}

export function emptyTrajectoryCounts(): HarnessParityTrajectoryCounts {
  return {
    frameCount: 0,
    toolCallCount: 0,
    toolResultCount: 0,
    statusCount: 0,
    resultCount: 0,
    truncatedFrameCount: 0,
  };
}

export function countTrajectoryFrames(
  frames: readonly HarnessParityTrajectoryFrame[],
): HarnessParityTrajectoryCounts {
  return {
    frameCount: frames.length,
    toolCallCount: frames.filter((frame) => frame.type === "tool_call").length,
    toolResultCount: frames.filter((frame) => frame.type === "tool_result").length,
    statusCount: frames.filter((frame) => frame.type === "status").length,
    resultCount: frames.filter((frame) => frame.type === "result").length,
    truncatedFrameCount: frames.filter(
      (frame) => frame.truncatedFields.length > 0,
    ).length,
  };
}

export function buildTrajectoryFrames(
  messages: readonly KotaAgentMessage[],
): HarnessParityTrajectoryFrame[] {
  const toolNamesByUseId = new Map<string, string>();
  return messages.map((rawMessage, index) => {
    const sanitized = sanitizeTrajectoryMessage(rawMessage);
    const frame: HarnessParityTrajectoryFrame = {
      index,
      type: sanitized.message.type,
      message: sanitized.message,
      truncatedFields: sanitized.truncatedFields,
    };
    if (sanitized.message.type === "tool_call") {
      toolNamesByUseId.set(
        sanitized.message.toolUseId,
        sanitized.message.toolName,
      );
      frame.toolName = sanitized.message.toolName;
    }
    if (sanitized.message.type === "tool_result") {
      const toolName = toolNamesByUseId.get(sanitized.message.toolUseId);
      if (toolName !== undefined) frame.toolName = toolName;
    }
    return frame;
  });
}
