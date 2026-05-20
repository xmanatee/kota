import type {
  KotaContentBlock,
  KotaToolResultBlockContent,
  KotaToolResultContentBlock,
} from "#core/agent-harness/message-protocol.js";
import type {
  ConversationMessage,
  ConversationRecord,
  HistoryProvider,
} from "#core/modules/provider-types.js";
import type {
	HistoryBoundedMessage,
	HistoryDetailView,
	HistoryMessageWindow,
	HistoryShowOptions,
	HistoryShowResult,
} from "./client.js";

export const DEFAULT_HISTORY_DETAIL_VIEW: HistoryDetailView = "window";
export const DEFAULT_HISTORY_DETAIL_OFFSET = 0;
export const DEFAULT_HISTORY_DETAIL_LIMIT = 20;
export const DEFAULT_HISTORY_DETAIL_CONTENT_LIMIT = 200;
export const MAX_HISTORY_DETAIL_LIMIT = 1000;
export const MAX_HISTORY_DETAIL_CONTENT_LIMIT = 20_000;
const HISTORY_RECORD_SCAN_LIMIT = 10_000;

export type HistoryDetailRequest =
  | { view: "metadata" }
  | {
      view: "window";
      offset: number;
      limit: number;
      contentLimit: number;
    }
  | { view: "full" };

export class HistoryDetailParameterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoryDetailParameterError";
  }
}

export function parseHistoryDetailRequestFromUrl(
  url: URL,
): HistoryDetailRequest {
  const view = parseView(url.searchParams.get("view") ?? DEFAULT_HISTORY_DETAIL_VIEW);
  const hasOffset = url.searchParams.has("offset");
  const hasLimit = url.searchParams.has("limit");
  const hasContentLimit = url.searchParams.has("contentLimit");

  if (view === "metadata" || view === "full") {
    rejectWindowParams(view, hasOffset, hasLimit, hasContentLimit);
    return { view };
  }

  return {
    view,
    offset: hasOffset
      ? parseNonNegativeInteger(url.searchParams.get("offset")!, "offset")
      : DEFAULT_HISTORY_DETAIL_OFFSET,
    limit: hasLimit
      ? parsePositiveInteger(
          url.searchParams.get("limit")!,
          "limit",
          MAX_HISTORY_DETAIL_LIMIT,
        )
      : DEFAULT_HISTORY_DETAIL_LIMIT,
    contentLimit: hasContentLimit
      ? parsePositiveInteger(
          url.searchParams.get("contentLimit")!,
          "contentLimit",
          MAX_HISTORY_DETAIL_CONTENT_LIMIT,
        )
      : DEFAULT_HISTORY_DETAIL_CONTENT_LIMIT,
  };
}

export function normalizeHistoryShowOptions(
  options?: HistoryShowOptions,
): HistoryDetailRequest {
  const view = parseView(options?.view ?? DEFAULT_HISTORY_DETAIL_VIEW);
  const hasOffset = options?.offset !== undefined;
  const hasLimit = options?.limit !== undefined;
  const hasContentLimit = options?.contentLimit !== undefined;

  if (view === "metadata" || view === "full") {
    rejectWindowParams(view, hasOffset, hasLimit, hasContentLimit);
    return { view };
  }

  return {
    view,
    offset: hasOffset
      ? validateNonNegativeInteger(options.offset!, "offset")
      : DEFAULT_HISTORY_DETAIL_OFFSET,
    limit: hasLimit
      ? validatePositiveInteger(options.limit!, "limit", MAX_HISTORY_DETAIL_LIMIT)
      : DEFAULT_HISTORY_DETAIL_LIMIT,
    contentLimit: hasContentLimit
      ? validatePositiveInteger(
          options.contentLimit!,
          "contentLimit",
          MAX_HISTORY_DETAIL_CONTENT_LIMIT,
        )
      : DEFAULT_HISTORY_DETAIL_CONTENT_LIMIT,
  };
}

export function buildHistoryDetailQuery(
  request: HistoryDetailRequest,
  projectId?: string,
): string {
  const params = new URLSearchParams();
  params.set("view", request.view);
  if (request.view === "window") {
    params.set("offset", String(request.offset));
    params.set("limit", String(request.limit));
    params.set("contentLimit", String(request.contentLimit));
  }
  if (projectId) params.set("projectId", projectId);
  return `?${params.toString()}`;
}

export function readHistoryDetail(
  provider: HistoryProvider,
  id: string,
  request: HistoryDetailRequest,
): HistoryShowResult {
  if (request.view === "metadata") {
    const record = findExactRecord(provider, id);
    if (!record) return { found: false };
    return {
      found: true,
      detail: {
        view: "metadata",
        record,
        messageWindow: {
          offset: 0,
          limit: 0,
          total: record.messageCount,
          returned: 0,
          hasMoreBefore: false,
          hasMoreAfter: record.messageCount > 0,
        },
      },
    };
  }

  const data = provider.load(id);
  if (!data) return { found: false };
  if (request.view === "full") {
    return {
      found: true,
      detail: {
        ...data,
        view: "full",
        messageWindow: fullMessageWindow(data.messages.length),
      },
    };
  }

  const total = data.messages.length;
  const messages = data.messages
    .slice(request.offset, request.offset + request.limit)
    .map((message, localIndex): HistoryBoundedMessage => {
      const bounded = truncateMessage(message, request.contentLimit);
      return {
        index: request.offset + localIndex,
        role: message.role,
        content: bounded.content,
        contentTruncation: {
          maxCharacters: request.contentLimit,
          originalCharacters: bounded.originalCharacters,
          truncated: bounded.truncated,
        },
      };
    });

  return {
    found: true,
    detail: {
      view: "window",
      record: data.record,
      messages,
      compactionCount: data.compactionCount,
      lastInputTokens: data.lastInputTokens,
      contentLimit: request.contentLimit,
      messageWindow: {
        offset: request.offset,
        limit: request.limit,
        total,
        returned: messages.length,
        hasMoreBefore: request.offset > 0 && total > 0,
        hasMoreAfter: request.offset + messages.length < total,
      },
    },
  };
}

function parseView(value: string): HistoryDetailView {
  if (value === "metadata" || value === "window" || value === "full") {
    return value;
  }
  throw new HistoryDetailParameterError(
    `view must be one of metadata, window, full; got "${value}"`,
  );
}

function rejectWindowParams(
  view: "metadata" | "full",
  hasOffset: boolean,
  hasLimit: boolean,
  hasContentLimit: boolean,
): void {
  const keys = [
    hasOffset ? "offset" : "",
    hasLimit ? "limit" : "",
    hasContentLimit ? "contentLimit" : "",
  ].filter(Boolean);
  if (keys.length === 0) return;
  throw new HistoryDetailParameterError(
    `${keys.join(", ")} ${keys.length === 1 ? "is" : "are"} only valid for view=window, not view=${view}`,
  );
}

function parseNonNegativeInteger(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || String(parsed) !== value || parsed < 0) {
    throw new HistoryDetailParameterError(
      `${name} must be a non-negative integer`,
    );
  }
  return parsed;
}

function parsePositiveInteger(
  value: string,
  name: string,
  max: number,
): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || String(parsed) !== value || parsed < 1) {
    throw new HistoryDetailParameterError(`${name} must be a positive integer`);
  }
  if (parsed > max) {
    throw new HistoryDetailParameterError(`${name} must be <= ${max}`);
  }
  return parsed;
}

function validateNonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new HistoryDetailParameterError(
      `${name} must be a non-negative integer`,
    );
  }
  return value;
}

function validatePositiveInteger(value: number, name: string, max: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new HistoryDetailParameterError(`${name} must be a positive integer`);
  }
  if (value > max) {
    throw new HistoryDetailParameterError(`${name} must be <= ${max}`);
  }
  return value;
}

function findExactRecord(
  provider: HistoryProvider,
  id: string,
): ConversationRecord | null {
  const records = provider.list({ limit: HISTORY_RECORD_SCAN_LIMIT });
  return records.find((record) => record.id === id) ?? null;
}

function fullMessageWindow(total: number): HistoryMessageWindow {
  return {
    offset: 0,
    limit: total,
    total,
    returned: total,
    hasMoreBefore: false,
    hasMoreAfter: false,
  };
}

function truncateMessage(
  message: ConversationMessage,
  maxCharacters: number,
): {
  content: ConversationMessage["content"];
  originalCharacters: number;
  truncated: boolean;
} {
  const originalCharacters = countContentCharacters(message.content);
  if (originalCharacters <= maxCharacters) {
    return {
      content: message.content,
      originalCharacters,
      truncated: false,
    };
  }
  const state = { remaining: maxCharacters };
  return {
    content: truncateContent(message.content, state),
    originalCharacters,
    truncated: true,
  };
}

function countContentCharacters(content: ConversationMessage["content"]): number {
  if (typeof content === "string") return content.length;
  return content.reduce((sum, block) => sum + countBlockCharacters(block), 0);
}

function countBlockCharacters(block: KotaContentBlock): number {
  switch (block.type) {
    case "text":
      return block.text.length;
    case "thinking":
      return block.thinking.length;
    case "tool_result":
      return countToolResultContentCharacters(block.content);
    default:
      return 0;
  }
}

function countToolResultContentCharacters(
  content: KotaToolResultBlockContent,
): number {
  if (typeof content === "string") return content.length;
  return content.reduce(
    (sum, block) => sum + countToolResultContentBlockCharacters(block),
    0,
  );
}

function countToolResultContentBlockCharacters(
  block: KotaToolResultContentBlock,
): number {
  if (block.type === "text") return block.text.length;
  return 0;
}

function truncateContent(
  content: ConversationMessage["content"],
  state: { remaining: number },
): ConversationMessage["content"] {
  if (typeof content === "string") {
    const text = takeCharacters(content, state);
    return text;
  }
  return content.map((block) => truncateBlock(block, state));
}

function truncateBlock(
  block: KotaContentBlock,
  state: { remaining: number },
): KotaContentBlock {
  switch (block.type) {
    case "text":
      return { ...block, text: takeCharacters(block.text, state) };
    case "thinking":
      return { ...block, thinking: takeCharacters(block.thinking, state) };
    case "tool_result":
      return {
        ...block,
        content: truncateToolResultContent(block.content, state),
      };
    default:
      return block;
  }
}

function truncateToolResultContent(
  content: KotaToolResultBlockContent,
  state: { remaining: number },
): KotaToolResultBlockContent {
  if (typeof content === "string") return takeCharacters(content, state);
  return content.map((block) => {
    if (block.type !== "text") return block;
    return { ...block, text: takeCharacters(block.text, state) };
  });
}

function takeCharacters(text: string, state: { remaining: number }): string {
  if (state.remaining <= 0) return "";
  const slice = text.slice(0, state.remaining);
  state.remaining -= slice.length;
  return slice;
}
