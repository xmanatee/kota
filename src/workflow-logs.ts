import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SDKMessage } from "./agent-sdk/types.js";
import type { WorkflowRunMetadata } from "./workflow/types.js";

const DEFAULT_MAX_LEN = 200;

export function truncateContent(text: string, max: number = DEFAULT_MAX_LEN): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}… [+${trimmed.length - max} chars]`;
}

type ContentBlock = {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  thinking?: string;
};

export function formatContentBlock(block: ContentBlock, maxLen: number = DEFAULT_MAX_LEN): string | null {
  switch (block.type) {
    case "text":
      return block.text ? truncateContent(block.text, maxLen) : null;
    case "thinking":
      return null;
    case "tool_use": {
      const inputStr = block.input != null ? JSON.stringify(block.input) : "";
      return `[tool: ${block.name}] ${truncateContent(inputStr, maxLen)}`;
    }
    case "tool_result": {
      const raw = typeof block.content === "string"
        ? block.content
        : JSON.stringify(block.content);
      return `[tool result] ${truncateContent(raw, maxLen)}`;
    }
    default:
      return null;
  }
}

export function formatAgentMessage(msg: SDKMessage, maxLen: number = DEFAULT_MAX_LEN): string[] {
  const lines: string[] = [];

  if (msg.type === "assistant") {
    const content: ContentBlock[] = (msg as { message?: { content?: ContentBlock[] }; content?: ContentBlock[] }).message?.content
      ?? (msg as { content?: ContentBlock[] }).content
      ?? [];
    for (const block of content) {
      const line = formatContentBlock(block, maxLen);
      if (line) lines.push(`[assistant] ${line}`);
    }
    return lines;
  }

  if (msg.type === "user") {
    const content: ContentBlock[] = (msg as { message?: { content?: ContentBlock[] }; content?: ContentBlock[] }).message?.content
      ?? (msg as { content?: ContentBlock[] }).content
      ?? [];
    for (const block of content) {
      const line = formatContentBlock(block, maxLen);
      if (line) lines.push(`[user]      ${line}`);
    }
    return lines;
  }

  if (msg.type === "result") {
    const r = msg as { total_cost_usd?: number; num_turns?: number; result?: string; subtype?: string };
    const parts: string[] = [`[result]    ${r.subtype ?? "done"}`];
    if (r.num_turns != null) parts.push(`turns=${r.num_turns}`);
    if (r.total_cost_usd != null) parts.push(`cost=$${r.total_cost_usd.toFixed(4)}`);
    lines.push(parts.join("  "));
    if (r.result) lines.push(`            ${truncateContent(r.result, maxLen)}`);
    return lines;
  }

  return lines;
}

export function readStepEvents(eventsPath: string): SDKMessage[] {
  if (!existsSync(eventsPath)) return [];
  let raw: string;
  try {
    raw = readFileSync(eventsPath, "utf-8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l) as SDKMessage; }
      catch { return null; }
    })
    .filter((m): m is SDKMessage => m !== null);
}

type StepLog = { stepId: string; lines: string[] };

export function buildRunLogs(
  runsDir: string,
  runId: string,
  metadata: WorkflowRunMetadata,
  filterStep?: string,
  maxLen: number = DEFAULT_MAX_LEN,
): StepLog[] {
  const agentSteps = metadata.steps.filter(
    (s) => s.type === "agent" && (!filterStep || s.id === filterStep),
  );

  return agentSteps.map((step) => {
    const eventsPath = join(runsDir, runId, "steps", `${step.id}.events.jsonl`);
    const events = readStepEvents(eventsPath);
    const lines: string[] = [];
    for (const event of events) {
      lines.push(...formatAgentMessage(event, maxLen));
    }
    return { stepId: step.id, lines };
  });
}
