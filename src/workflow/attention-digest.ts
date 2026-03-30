import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readOptionalJsonFile, writeJsonFileAtomic } from "../json-file.js";
import { countRepoTasks } from "../repo-tasks.js";
import { callTelegramApi } from "../telegram-client.js";
import {
  computeCostByWorkflow,
  loadRecentRuns,
  type RunSummary,
} from "../workflows/shared.js";
import { PAUSE_SIGNAL_FILE } from "./runtime.js";

const DIGEST_EVERY_N_RUNS = 10;
const DEFAULT_COST_WARN_THRESHOLD_USD = 25;
const DEFAULT_COST_HARD_LIMIT_USD = 50;

type AttentionItem = { label: string; detail: string };

function builderFailureStreak(recentRuns: RunSummary[]): number {
  // recentRuns is most-recent-first; count consecutive builder failures from the head
  let streak = 0;
  for (const run of recentRuns) {
    if (run.workflow !== "builder") continue;
    if (run.status === "failed" || run.status === "interrupted") {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function detectAttentionItems(
  projectDir: string,
  recentRuns: RunSummary[],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  const streak = builderFailureStreak(recentRuns);
  if (streak >= 3) {
    items.push({
      label: "Builder failure streak",
      detail: `${streak} consecutive failures`,
    });
  }

  const totalCost = Object.values(computeCostByWorkflow(recentRuns)).reduce(
    (a, b) => a + b,
    0,
  );
  const threshold =
    Number(process.env.KOTA_DIGEST_COST_THRESHOLD) ||
    DEFAULT_COST_WARN_THRESHOLD_USD;
  if (totalCost > threshold) {
    items.push({
      label: "Budget pressure",
      detail: `$${totalCost.toFixed(2)} spent in last 24h (threshold: $${threshold})`,
    });
  }

  const doingCount = countRepoTasks(projectDir, "doing");
  if (doingCount >= 2) {
    items.push({
      label: "Stalled work",
      detail: `${doingCount} tasks stuck in doing`,
    });
  }

  const blockedCount = countRepoTasks(projectDir, "blocked");
  if (blockedCount >= 2) {
    items.push({
      label: "Blocked backlog",
      detail: `${blockedCount} blocked tasks`,
    });
  }

  const readyCount = countRepoTasks(projectDir, "ready");
  if (readyCount === 0) {
    items.push({
      label: "Empty ready queue",
      detail: "Builder has nothing to pull.",
    });
  }

  const backlogCount = countRepoTasks(projectDir, "backlog");
  if (backlogCount === 0) {
    items.push({
      label: "Empty backlog",
      detail: "No reserves for explorer to promote.",
    });
  }

  return items;
}

function buildDigestText(items: AttentionItem[]): string {
  const header = `Attention digest (${items.length} item${items.length === 1 ? "" : "s"}):`;
  const body = items
    .map((item) => `• *${item.label}*: ${item.detail}`)
    .join("\n");
  return `${header}\n${body}`;
}

/**
 * Run one attention digest step. Increments the persistent counter and, every
 * DIGEST_EVERY_N_RUNS invocations, checks for attention items and sends a
 * Telegram message when any are found.
 *
 * Called directly by the attention-digest workflow code step.
 */
export function runAttentionDigestStep(
  projectDir: string,
  runsDir: string,
  log?: (message: string) => void,
): void {
  // Counter is persisted so it survives daemon restarts (which happen after every builder build).
  const counterFile = join(runsDir, "..", "attention-digest-counter.json");

  const saved = readOptionalJsonFile<{ count: number }>(counterFile);
  const count = (saved?.count ?? 0) + 1;
  writeJsonFileAtomic(counterFile, { count });
  if (count % DIGEST_EVERY_N_RUNS !== 0) return;

  const recentRuns = loadRecentRuns(runsDir);
  const totalCost = Object.values(computeCostByWorkflow(recentRuns)).reduce(
    (a, b) => a + b,
    0,
  );
  const hardLimit =
    Number(process.env.KOTA_COST_HARD_LIMIT_USD) || DEFAULT_COST_HARD_LIMIT_USD;

  if (totalCost > hardLimit) {
    writeFileSync(join(projectDir, ".kota", PAUSE_SIGNAL_FILE), "");
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    if (token && chatId) {
      void callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: `Cost circuit breaker tripped: $${totalCost.toFixed(2)} spent in last 24h (hard limit: $${hardLimit}). Autonomous dispatch paused. Delete \`.kota/${PAUSE_SIGNAL_FILE}\` to resume.`,
        parse_mode: "Markdown",
      }).catch((err: unknown) => {
        log?.(`Failed to send circuit breaker alert: ${(err as Error).message}`);
      });
    }
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!token || !chatId) return;

  const items = detectAttentionItems(projectDir, recentRuns);
  if (items.length === 0) return;

  const text = buildDigestText(items);
  void callTelegramApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  }).catch((err: unknown) => {
    log?.(`Failed to send attention digest: ${(err as Error).message}`);
  });
}
