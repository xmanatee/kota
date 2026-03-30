import type { WorkflowRunStore } from "./run-store.js";

export class BudgetGuard {
  pausedDate: string | null = null;

  check(
    store: WorkflowRunStore,
    budget: number,
    log: (message: string) => void,
    onBudgetExceeded?: (dailySpend: number, budget: number, text: string) => void,
  ): boolean {
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (this.pausedDate) {
      if (this.pausedDate === todayUtc) return true;
      this.pausedDate = null;
    }
    const dailySpend = store.getDailySpendUsd();
    if (dailySpend >= budget) {
      this.pausedDate = todayUtc;
      this.sendAlert(dailySpend, budget, log, onBudgetExceeded);
      return true;
    }
    return false;
  }

  private sendAlert(
    dailySpend: number,
    budget: number,
    log: (message: string) => void,
    onBudgetExceeded?: (dailySpend: number, budget: number, text: string) => void,
  ): void {
    log(
      `Daily budget of $${budget.toFixed(4)} reached ($${dailySpend.toFixed(4)} spent). Dispatch paused until tomorrow (UTC).`,
    );
    const text = [
      "Daily cost budget reached.",
      `Spent: $${dailySpend.toFixed(4)}`,
      `Budget: $${budget.toFixed(4)}`,
      "Workflow dispatch paused until tomorrow (UTC).",
    ].join("\n");
    onBudgetExceeded?.(dailySpend, budget, text);
  }
}
