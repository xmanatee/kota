function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Agent run wait aborted");
}

type Waiter = {
  resolve: () => void;
  reject: (reason: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export type AgentRunLimiter = {
  readonly limit: number;
  run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
};

class SemaphoreAgentRunLimiter implements AgentRunLimiter {
  readonly limit: number;
  private slots: number;
  private readonly waiters: Waiter[] = [];

  constructor(limit: number) {
    this.limit = limit;
    this.slots = limit;
  }

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortReason(signal);
    if (this.slots > 0) {
      this.slots--;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve: () => {
          if (waiter.signal && waiter.onAbort) {
            waiter.signal.removeEventListener("abort", waiter.onAbort);
          }
          resolve();
        },
        reject,
        signal,
      };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(abortReason(signal));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next.resolve();
      return;
    }
    this.slots++;
  }
}

export function createAgentRunLimiter(limit: number | undefined): AgentRunLimiter | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`agentConcurrency must be a positive integer, got ${String(limit)}`);
  }
  return new SemaphoreAgentRunLimiter(limit);
}
