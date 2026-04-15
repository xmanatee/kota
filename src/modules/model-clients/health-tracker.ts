import { tryEmit } from "#core/events/event-bus.js";

export type ProviderHealthState = {
  status: "healthy" | "unhealthy";
  errorCount: number;
  totalCount: number;
  lastErrorAt: string | null;
  failedOverSince: string | null;
};

export type HealthTrackerConfig = {
  windowMs: number;
  errorThreshold: number;
  cooldownMs: number;
  primaryName: string;
  fallbackName: string;
};

type TimestampedOutcome = {
  at: number;
  error: boolean;
};

export class ProviderHealthTracker {
  private outcomes: TimestampedOutcome[] = [];
  private failedOverAt: number | null = null;
  private lastErrorAt: number | null = null;
  private readonly config: HealthTrackerConfig;

  constructor(config: HealthTrackerConfig) {
    this.config = config;
  }

  recordSuccess(): void {
    this.outcomes.push({ at: Date.now(), error: false });
    this.prune();
  }

  recordError(): void {
    const now = Date.now();
    this.lastErrorAt = now;
    this.outcomes.push({ at: now, error: true });
    this.prune();

    if (!this.failedOverAt && this.errorCountInWindow() >= this.config.errorThreshold) {
      this.failedOverAt = now;
      tryEmit("model.provider.failover", {
        from: this.config.primaryName,
        to: this.config.fallbackName,
        reason: `${this.config.errorThreshold} errors in ${this.config.windowMs}ms window`,
        direction: "failover",
      });
    }
  }

  isHealthy(): boolean {
    return this.failedOverAt === null;
  }

  shouldProbe(): boolean {
    if (this.failedOverAt === null) return false;
    return Date.now() - this.failedOverAt >= this.config.cooldownMs;
  }

  markRecovered(): void {
    if (this.failedOverAt === null) return;
    this.failedOverAt = null;
    this.outcomes = [];
    tryEmit("model.provider.failover", {
      from: this.config.fallbackName,
      to: this.config.primaryName,
      reason: "primary recovered after cooldown probe",
      direction: "recovery",
    });
  }

  markProbeFailed(): void {
    this.failedOverAt = Date.now();
  }

  getHealthState(): ProviderHealthState {
    this.prune();
    return {
      status: this.failedOverAt === null ? "healthy" : "unhealthy",
      errorCount: this.errorCountInWindow(),
      totalCount: this.outcomes.length,
      lastErrorAt: this.lastErrorAt ? new Date(this.lastErrorAt).toISOString() : null,
      failedOverSince: this.failedOverAt ? new Date(this.failedOverAt).toISOString() : null,
    };
  }

  private prune(): void {
    const cutoff = Date.now() - this.config.windowMs;
    while (this.outcomes.length > 0 && this.outcomes[0].at < cutoff) {
      this.outcomes.shift();
    }
  }

  private errorCountInWindow(): number {
    const cutoff = Date.now() - this.config.windowMs;
    let count = 0;
    for (const o of this.outcomes) {
      if (o.at >= cutoff && o.error) count++;
    }
    return count;
  }
}
