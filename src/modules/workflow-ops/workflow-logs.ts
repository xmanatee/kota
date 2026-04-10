import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SDKMessage } from "../../agent-sdk/types.js";
import { readOptionalJsonFile } from "../../json-file.js";
import type { WorkflowRunMetadata, WorkflowRuntimeState } from "../../core/workflow/run-types.js";

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

export function filterWithContext(
  lines: string[],
  pattern: string,
  isRegex: boolean,
  context: number,
): string[] {
  if (!pattern) return lines;
  const re = isRegex ? new RegExp(pattern) : null;
  const matches = (line: string) => (re ? re.test(line) : line.includes(pattern));
  const include = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (matches(lines[i])) {
      for (let c = Math.max(0, i - context); c <= Math.min(lines.length - 1, i + context); c++) {
        include.add(c);
      }
    }
  }
  return Array.from(include)
    .sort((a, b) => a - b)
    .map((i) => lines[i]);
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

type StepFollowState = { headerPrinted: boolean; linesEmitted: number };

function emitNewStepEvents(
  runsDir: string,
  runId: string,
  stepId: string,
  state: StepFollowState,
  maxLen: number,
): void {
  const eventsPath = join(runsDir, runId, "steps", `${stepId}.events.jsonl`);
  const allEvents = readStepEvents(eventsPath);
  const newEvents = allEvents.slice(state.linesEmitted);
  for (const event of newEvents) {
    if (!state.headerPrinted) {
      console.log(`\n── Step: ${stepId} ${"─".repeat(Math.max(0, 60 - stepId.length))}`);
      state.headerPrinted = true;
    }
    for (const line of formatAgentMessage(event, maxLen)) {
      console.log(line);
    }
  }
  state.linesEmitted = allEvents.length;
}

export async function followRunLogs(
  runsDir: string,
  statePath: string,
  runId: string | undefined,
  filterStep: string | undefined,
  maxLen = DEFAULT_MAX_LEN,
  pollIntervalMs = 500,
): Promise<void> {
  // If a completed run is specified, print it synchronously and return.
  if (runId) {
    const metadataPath = join(runsDir, runId, "metadata.json");
    const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
    if (metadata && metadata.status !== "running") {
      const stepLogs = buildRunLogs(runsDir, runId, metadata, filterStep, maxLen);
      for (const { stepId, lines } of stepLogs) {
        console.log(`\n── Step: ${stepId} ${"─".repeat(Math.max(0, 60 - stepId.length))}`);
        for (const line of lines) console.log(line);
      }
      return;
    }
  }

  const stepStates = new Map<string, StepFollowState>();
  let activeRunId = runId;
  let waitingPrinted = false;

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      clearInterval(timer);
      process.off("SIGINT", cleanup);
      resolve();
    };

    process.once("SIGINT", cleanup);

    const timer = setInterval(() => {
      if (!activeRunId) {
        const wfState = readOptionalJsonFile<WorkflowRuntimeState>(statePath);
        const firstActiveRunId = wfState?.activeRuns?.[0]?.runId;
        if (!firstActiveRunId) {
          if (!waitingPrinted) {
            console.log("Waiting for an active run...");
            waitingPrinted = true;
          }
          return;
        }
        activeRunId = firstActiveRunId;
        console.log(`Following run: ${activeRunId}`);
      }

      const metadataPath = join(runsDir, activeRunId, "metadata.json");
      const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
      if (!metadata) return;

      const agentSteps = metadata.steps.filter(
        (s) => s.type === "agent" && (!filterStep || s.id === filterStep),
      );
      for (const step of agentSteps) {
        if (!stepStates.has(step.id)) {
          stepStates.set(step.id, { headerPrinted: false, linesEmitted: 0 });
        }
        emitNewStepEvents(runsDir, activeRunId, step.id, stepStates.get(step.id)!, maxLen);
      }

      if (metadata.status !== "running") {
        cleanup();
      }
    }, pollIntervalMs);
  });
}
