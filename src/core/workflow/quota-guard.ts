import type { ReadWeeklyQuota, WeeklyQuotaSnapshot } from "#core/agent-harness/quota.js";

export type QuotaGuardPolicy = { enabled: boolean; reservePercentPerDay: number };

export function evaluateWeeklyQuota(
  snapshot: WeeklyQuotaSnapshot,
  percentPerDay: number,
  now = Date.now(),
): { blocked: boolean; remaining: number; reserve: number } {
  if (!Number.isFinite(snapshot.usedPercent) || snapshot.usedPercent < 0 || snapshot.usedPercent > 100
    || !Number.isFinite(snapshot.resetsAt) || snapshot.resetsAt * 1000 <= now) {
    throw new Error("Weekly quota snapshot is invalid or its reset window has expired");
  }
  const daysLeft = Math.floor((snapshot.resetsAt * 1000 - now) / 86_400_000);
  const reserve = Math.min(100, daysLeft * percentPerDay);
  const remaining = 100 - snapshot.usedPercent;
  return { blocked: remaining <= reserve, remaining, reserve };
}

/** Owns only the quota admission hold. Operator and recovery holds stay independent. */
export class QuotaGuard {
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pauseMessage: string | null = null;

  constructor(private readonly deps: {
    hold: () => void;
    release: () => void;
    log: (message: string) => void;
    now?: () => number;
  }) {}

  get message(): string | null {
    return this.pauseMessage;
  }

  configure(policy: QuotaGuardPolicy | undefined, read: ReadWeeklyQuota | undefined): void {
    this.cancelProbe();
    if (!policy?.enabled) {
      this.pauseMessage = null;
      this.deps.release();
      return;
    }
    this.pauseMessage = "Waiting for an authoritative weekly quota snapshot.";
    this.deps.hold();
    const controller = new AbortController();
    this.controller = controller;
    let lastDiagnostic = "";
    const poll = async (): Promise<void> => {
      try {
        if (!read) throw new Error("Selected agent harness does not support weekly quota inspection");
        const snapshot = await read(AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(20_000),
        ]));
        if (controller.signal.aborted) return;
        const decision = evaluateWeeklyQuota(snapshot, policy.reservePercentPerDay, this.deps.now?.());
        const message = `Weekly quota: ${decision.remaining}% remaining, ${decision.reserve}% reserved; reset ${new Date(snapshot.resetsAt * 1000).toISOString()}.`;
        const wasBlocked = this.pauseMessage !== null;
        this.pauseMessage = decision.blocked ? message : null;
        if (decision.blocked) this.deps.hold();
        else this.deps.release();
        if (wasBlocked !== decision.blocked || lastDiagnostic !== "ok") {
          this.deps.log(`Quota guard ${decision.blocked ? "paused" : "released"} dispatch. ${message}`);
        }
        lastDiagnostic = "ok";
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = `unavailable: ${error instanceof Error ? error.message : String(error)}`;
        if (this.pauseMessage !== null) this.pauseMessage = `Quota guard ${message}`;
        if (lastDiagnostic !== message) this.deps.log(`Quota guard ${message}; retaining current quota admission state.`);
        lastDiagnostic = message;
      } finally {
        if (!controller.signal.aborted) {
          this.timer = setTimeout(() => { void poll(); }, 60_000);
          this.timer.unref();
        }
      }
    };
    void poll();
  }

  stop(): void {
    this.cancelProbe();
  }

  private cancelProbe(): void {
    this.controller?.abort();
    this.controller = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
