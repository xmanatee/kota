/**
 * ActionExecutor — runs autonomous agent actions triggered by the scheduler.
 *
 * When a scheduled item has an `action` prompt, the executor creates a
 * lightweight agent session, sends the prompt, collects the result, and
 * delivers it via a callback. This transforms KOTA from a reactive tool
 * into a proactive agent that can act without being prompted.
 */

import { tryEmit } from "./event-bus.js";
import { AgentSession, type LoopOptions } from "./loop.js";
import type { ScheduledItem } from "./scheduler.js";
import { BufferTransport } from "./transport.js";

export type ActionResult = {
  item: ScheduledItem;
  result: string;
  error?: string;
  durationMs: number;
};

export type ActionExecutorOptions = {
  /** Base options for agent sessions created by the executor. */
  sessionOptions: Partial<LoopOptions>;
  /** Max concurrent actions. Prevents runaway resource usage. */
  maxConcurrent?: number;
  /** Max duration per action in ms. Default: 120s. */
  timeoutMs?: number;
};

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_TIMEOUT_MS = 120_000;

export class ActionExecutor {
  private running = 0;
  private sessionOptions: Partial<LoopOptions>;
  private maxConcurrent: number;
  private timeoutMs: number;

  constructor(options: ActionExecutorOptions) {
    this.sessionOptions = options.sessionOptions;
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Check if the executor can accept more actions. */
  canExecute(): boolean {
    return this.running < this.maxConcurrent;
  }

  get activeCount(): number {
    return this.running;
  }

  /**
   * Execute a scheduled item's action prompt.
   * Returns the result or error. Does not throw.
   */
  async execute(item: ScheduledItem): Promise<ActionResult> {
    if (!item.action) {
      return {
        item,
        result: "",
        error: "No action defined",
        durationMs: 0,
      };
    }

    if (!this.canExecute()) {
      return {
        item,
        result: "",
        error: `Max concurrent actions (${this.maxConcurrent}) reached`,
        durationMs: 0,
      };
    }

    this.running++;
    const start = Date.now();
    tryEmit("action.start", { itemId: item.id, description: item.description });

    try {
      const result = await this.runWithTimeout(item.action, item.description);
      const durationMs = Date.now() - start;
      tryEmit("action.complete", { itemId: item.id, durationMs });
      return { item, result, durationMs };
    } catch (err) {
      const durationMs = Date.now() - start;
      tryEmit("action.complete", { itemId: item.id, error: (err as Error).message, durationMs });
      return { item, result: "", error: (err as Error).message, durationMs };
    } finally {
      this.running--;
    }
  }

  private async runWithTimeout(prompt: string, context: string): Promise<string> {
    const transport = new BufferTransport();
    const session = new AgentSession({
      ...this.sessionOptions,
      transport,
      historySource: "action",
    });

    const wrappedPrompt =
      `[Autonomous action triggered by schedule: "${context}"]\n\n${prompt}\n\n` +
      "Be concise. Complete the task and report the result. " +
      "Do not ask for clarification — make reasonable assumptions.";

    const resultPromise = session.send(wrappedPrompt).finally(() => session.close());

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        session.close();
        reject(new Error(`Action timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      timer.unref();
    });

    return Promise.race([resultPromise, timeoutPromise]);
  }
}

/**
 * Partition due items into action items (have agent_action) and
 * notification-only items (just reminders).
 */
export function partitionDueItems(items: ScheduledItem[]): {
  actions: ScheduledItem[];
  notifications: ScheduledItem[];
} {
  const actions: ScheduledItem[] = [];
  const notifications: ScheduledItem[] = [];
  for (const item of items) {
    if (item.action) {
      actions.push(item);
    } else {
      notifications.push(item);
    }
  }
  return { actions, notifications };
}
