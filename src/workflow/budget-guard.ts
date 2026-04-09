import type { WorkflowRunStore } from "./run-store.js";

export class BudgetGuard {
  pausedDate: string | null = null;
  warnedDate: string | null = null;

  check(
    store: WorkflowRunStore,
    budget: number,
    log: (message: string) => void,
    onBudgetExceeded?: (dailySpend: number, budget: number, text: string) => void,
    warnAt?: number,
    onBudgetWarning?: (dailySpend: number, budget: number, warnAt: number, text: string) => void,
  ): boolean {
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (this.pausedDate) {
      if (this.pausedDate === todayUtc) return true;
      this.pausedDate = null;
    }
    if (this.warnedDate && this.warnedDate !== todayUtc) {
      this.warnedDate = null;
    }
    const dailySpend = store.getDailySpendUsd();
    if (dailySpend >= budget) {
      this.pausedDate = todayUtc;
      this.sendAlert(dailySpend, budget, log, onBudgetExceeded);
      return true;
    }
    if (warnAt != null && onBudgetWarning && !this.warnedDate && dailySpend >= budget * warnAt) {
      this.warnedDate = todayUtc;
      this.sendWarning(dailySpend, budget, warnAt, log, onBudgetWarning);
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

  private sendWarning(
    dailySpend: number,
    budget: number,
    warnAt: number,
    log: (message: string) => void,
    onBudgetWarning: (dailySpend: number, budget: number, warnAt: number, text: string) => void,
  ): void {
    const pct = Math.round((dailySpend / budget) * 100);
    log(
      `Budget soft-limit reached: $${dailySpend.toFixed(4)} spent of $${budget.toFixed(4)} daily limit (${pct}%).`,
    );
    const text = [
      `Daily cost at ${pct}% of budget (soft-limit: ${Math.round(warnAt * 100)}%).`,
      `Spent: $${dailySpend.toFixed(4)}`,
      `Budget: $${budget.toFixed(4)}`,
    ].join("\n");
    onBudgetWarning(dailySpend, budget, warnAt, text);
  }
}
