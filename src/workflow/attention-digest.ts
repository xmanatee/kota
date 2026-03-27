import type { EventBus } from "../event-bus.js";
import { countRepoTasks } from "../repo-tasks.js";
import { callTelegramApi } from "../telegram-client.js";
import {
  computeCostByWorkflow,
  loadRecentRuns,
  type RunSummary,
} from "../workflows/shared.js";

const DIGEST_EVERY_N_RUNS = 10;
const DEFAULT_COST_WARN_THRESHOLD_USD = 25;

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

  return items;
}

function buildDigestText(items: AttentionItem[]): string {
  const header = `Attention digest (${items.length} item${items.length === 1 ? "" : "s"}):`;
  const body = items
    .map((item) => `• *${item.label}*: ${item.detail}`)
    .join("\n");
  return `${header}\n${body}`;
}

export function subscribeAttentionDigest(
  bus: EventBus,
  projectDir: string,
  runsDir: string,
  log?: (message: string) => void,
): () => void {
  let completionCount = 0;

  return bus.on("workflow.completed", () => {
    completionCount++;
    if (completionCount % DIGEST_EVERY_N_RUNS !== 0) return;

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    if (!token || !chatId) return;

    const recentRuns = loadRecentRuns(runsDir);
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
  });
}
