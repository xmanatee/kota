import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  KotaAgentMessage,
  KotaAgentResultMessage,
  KotaAgentStatusMessage,
  KotaAgentTextMessage,
  KotaAgentToolCallMessage,
  KotaAgentToolResultMessage,
} from "#core/agent-harness/index.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunMetadata, WorkflowRuntimeState } from "#core/workflow/run-types.js";
import { line, plain } from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";

const DEFAULT_MAX_LEN = 200;

export function truncateContent(text: string, max: number = DEFAULT_MAX_LEN): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}… [+${trimmed.length - max} chars]`;
}

export function stepBanner(stepId: string): string {
  return `── Step: ${stepId} ${"─".repeat(Math.max(0, 60 - stepId.length))}`;
}

function renderTextMessage(
  message: KotaAgentTextMessage,
  maxLen: number,
): string | null {
  if (!message.text) return null;
  return `[assistant] ${truncateContent(message.text, maxLen)}`;
}

function renderToolCallMessage(
  message: KotaAgentToolCallMessage,
  maxLen: number,
): string {
  const inputStr = JSON.stringify(message.input);
  return `[assistant] [tool: ${message.toolName}] ${truncateContent(inputStr, maxLen)}`;
}

function renderToolResultMessage(
  message: KotaAgentToolResultMessage,
  maxLen: number,
): string {
  const raw =
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content);
  return `[user]      [tool result] ${truncateContent(raw, maxLen)}`;
}

function renderResultMessage(
  message: KotaAgentResultMessage,
  maxLen: number,
): string[] {
  const parts: string[] = [
    `[result]    ${message.subtype ?? (message.isError ? "error" : "done")}`,
  ];
  if (message.numTurns !== undefined) parts.push(`turns=${message.numTurns}`);
  if (message.totalCostUsd !== undefined)
    parts.push(`cost=$${message.totalCostUsd.toFixed(4)}`);
  const lines = [parts.join("  ")];
  if (message.text) lines.push(`            ${truncateContent(message.text, maxLen)}`);
  return lines;
}

function renderStatusMessage(
  message: KotaAgentStatusMessage,
  maxLen: number,
): string | null {
  const detail =
    message.text ?? message.description ?? message.toolName ?? null;
  if (!detail) return null;
  return `[status]    ${message.category}: ${truncateContent(detail, maxLen)}`;
}

export function formatAgentMessage(
  msg: KotaAgentMessage,
  maxLen: number = DEFAULT_MAX_LEN,
): string[] {
  switch (msg.type) {
    case "text": {
      const line = renderTextMessage(msg, maxLen);
      return line ? [line] : [];
    }
    case "thinking":
      // Thinking blocks have a dedicated route (see workflow-run-routes.ts)
      // and stay out of the streaming log to avoid leaking reasoning into
      // operator-facing transcripts.
      return [];
    case "tool_call":
      return [renderToolCallMessage(msg, maxLen)];
    case "tool_result":
      return [renderToolResultMessage(msg, maxLen)];
    case "result":
      return renderResultMessage(msg, maxLen);
    case "status": {
      const line = renderStatusMessage(msg, maxLen);
      return line ? [line] : [];
    }
    case "raw":
      return [];
  }
}

export function readStepEvents(eventsPath: string): KotaAgentMessage[] {
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
      try { return JSON.parse(l) as KotaAgentMessage; }
      catch { return null; }
    })
    .filter((m): m is KotaAgentMessage => m !== null);
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
      print(line(plain("")));
      print(line(plain(stepBanner(stepId))));
      state.headerPrinted = true;
    }
    for (const l of formatAgentMessage(event, maxLen)) {
      print(line(plain(l)));
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
  if (runId) {
    const metadataPath = join(runsDir, runId, "metadata.json");
    const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
    if (metadata && metadata.status !== "running") {
      const stepLogs = buildRunLogs(runsDir, runId, metadata, filterStep, maxLen);
      for (const { stepId, lines } of stepLogs) {
        print(line(plain("")));
        print(line(plain(stepBanner(stepId))));
        for (const l of lines) print(line(plain(l)));
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
            print(line(plain("Waiting for an active run...")));
            waitingPrinted = true;
          }
          return;
        }
        activeRunId = firstActiveRunId;
        print(line(plain(`Following run: ${activeRunId}`)));
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
