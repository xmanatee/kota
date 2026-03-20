import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EventBus } from "../event-bus.js";
import { callTelegramApi } from "../telegram-client.js";

const MAX_ERROR_LENGTH = 300;

function readErrorFile(projectDir: string, runDir: string): string {
  try {
    return readFileSync(resolve(projectDir, runDir, "error.txt"), "utf-8").trim();
  } catch {
    return "";
  }
}

function buildAlertText(
  workflow: string,
  runId: string,
  status: "failed" | "interrupted",
  durationMs: number,
  errorSummary: string,
): string {
  const durationSec = (durationMs / 1000).toFixed(1);
  const lines = [
    `Workflow ${status}: *${workflow}*`,
    `Run: \`${runId}\``,
    `Duration: ${durationSec}s`,
  ];
  if (errorSummary) {
    const truncated =
      errorSummary.length > MAX_ERROR_LENGTH
        ? `${errorSummary.slice(0, MAX_ERROR_LENGTH - 3)}...`
        : errorSummary;
    lines.push(`Error: ${truncated}`);
  }
  return lines.join("\n");
}

export function subscribeWorkflowFailureAlert(
  bus: EventBus,
  projectDir: string,
  log?: (message: string) => void,
): () => void {
  return bus.on("workflow.completed", (payload) => {
    if (payload.status !== "failed" && payload.status !== "interrupted") return;

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    if (!token || !chatId) return;

    const errorSummary = readErrorFile(projectDir, payload.runDir);
    const text = buildAlertText(
      payload.workflow,
      payload.runId,
      payload.status,
      payload.durationMs,
      errorSummary,
    );

    void callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }).catch((err: unknown) => {
      log?.(`Failed to send workflow failure alert: ${(err as Error).message}`);
    });
  });
}
