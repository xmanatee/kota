import { callTelegramApi } from "../telegram-client.js";
import type { WorkflowRunStore } from "./run-store.js";

export class BudgetGuard {
  pausedDate: string | null = null;

  check(
    store: WorkflowRunStore,
    budget: number,
    log: (message: string) => void,
  ): boolean {
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (this.pausedDate) {
      if (this.pausedDate === todayUtc) return true;
      this.pausedDate = null;
    }
    const dailySpend = store.getDailySpendUsd();
    if (dailySpend >= budget) {
      this.pausedDate = todayUtc;
      this.sendAlert(dailySpend, budget, log);
      return true;
    }
    return false;
  }

  private sendAlert(
    dailySpend: number,
    budget: number,
    log: (message: string) => void,
  ): void {
    log(
      `Daily budget of $${budget.toFixed(4)} reached ($${dailySpend.toFixed(4)} spent). Dispatch paused until tomorrow (UTC).`,
    );
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    if (!token || !chatId) return;
    const text = [
      "Daily cost budget reached.",
      `Spent: $${dailySpend.toFixed(4)}`,
      `Budget: $${budget.toFixed(4)}`,
      "Workflow dispatch paused until tomorrow (UTC).",
    ].join("\n");
    void callTelegramApi(token, "sendMessage", { chat_id: chatId, text }).catch(
      (err: unknown) => {
        log(`Failed to send budget alert: ${(err as Error).message}`);
      },
    );
  }
}
