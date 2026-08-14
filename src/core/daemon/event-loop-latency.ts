export type EventLoopLatencySnapshot = {
  intervalMs: number;
  lastDelayMs: number;
  maxDelayMs: number;
  sampledAt: string;
};

const DEFAULT_EVENT_LOOP_SAMPLE_INTERVAL_MS = 100;

/** Lightweight daemon-owned event-loop delay evidence exposed by /health. */
export class DaemonEventLoopLatencyMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private expectedAt = 0;
  private lastDelayMs = 0;
  private maxDelayMs = 0;
  private sampledAt = new Date().toISOString();

  constructor(
    private readonly intervalMs = DEFAULT_EVENT_LOOP_SAMPLE_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.expectedAt = Date.now() + this.intervalMs;
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  snapshot(): EventLoopLatencySnapshot {
    return {
      intervalMs: this.intervalMs,
      lastDelayMs: this.lastDelayMs,
      maxDelayMs: this.maxDelayMs,
      sampledAt: this.sampledAt,
    };
  }

  private sample(): void {
    const now = Date.now();
    this.lastDelayMs = Math.max(0, now - this.expectedAt);
    this.maxDelayMs = Math.max(this.maxDelayMs, this.lastDelayMs);
    this.sampledAt = new Date(now).toISOString();
    this.expectedAt = now + this.intervalMs;
  }
}
