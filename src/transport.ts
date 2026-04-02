/**
 * Transport layer — decouples agent I/O from any specific frontend.
 *
 * The agent emits typed events. A Transport decides how to render them.
 * CliTransport writes to stdout/stderr (current behavior).
 * Other transports (Telegram, web, Discord) subscribe to the same events.
 */

/** Events emitted by the agent during execution. */
export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "thinking_start" }
  | { type: "progress"; content: string; source?: string }
  | { type: "status"; message: string }
  | { type: "cost"; summary: string; budgetPercent: number; turn?: number; turnCostUsd?: number; totalCostUsd?: number }
  | { type: "error"; message: string }
  | { type: "notification"; id: number; description: string; scheduledFor: string }
  | { type: "guardrail"; tool: string; risk: string; policy: string; reason: string }
  | { type: "tool_metric"; tool: string; durationMs: number; success: boolean }
  | { type: "state_change"; from: string; to: string; meta?: Record<string, unknown> };

/** Receives agent events and renders them for a specific frontend. */
export interface Transport {
  emit(event: AgentEvent): void;
}

/**
 * CLI transport — renders events to stdout/stderr.
 * Reproduces the original terminal behavior exactly.
 */
export class CliTransport implements Transport {
  private verbose: boolean;
  private showCost: boolean;

  constructor(verbose = false, showCost = true) {
    this.verbose = verbose;
    this.showCost = showCost;
  }

  emit(event: AgentEvent): void {
    switch (event.type) {
      case "text":
        process.stdout.write(event.content);
        break;
      case "thinking":
        if (this.verbose) process.stderr.write(event.content);
        break;
      case "thinking_start":
        if (this.verbose) {
          process.stderr.write("[thinking] ");
        } else {
          process.stderr.write("[kota] Thinking...\n");
        }
        break;
      case "progress":
        process.stderr.write(event.content);
        break;
      case "status":
        console.error(event.message);
        break;
      case "cost": {
        if (!this.showCost) break;
        let msg: string;
        if (event.turn !== undefined && event.turnCostUsd !== undefined && event.totalCostUsd !== undefined) {
          msg = `[kota] Turn ${event.turn} — $${event.turnCostUsd.toFixed(4)} this turn · $${event.totalCostUsd.toFixed(4)} total — context: ${event.budgetPercent}%`;
        } else {
          msg = `[kota] ${event.summary} — context: ${event.budgetPercent}%`;
        }
        console.error(msg);
        break;
      }
      case "error":
        console.error(event.message);
        break;
      case "notification":
        console.error(`[reminder] ${event.description}`);
        break;
      case "guardrail":
        if (event.policy !== "allow") {
          console.error(`[guardrail] ${event.tool}: ${event.policy} (${event.risk} — ${event.reason})`);
        } else if (this.verbose) {
          console.error(`[guardrail] ${event.tool}: ${event.policy} (${event.risk})`);
        }
        break;
      case "tool_metric":
        if (this.verbose) {
          const status = event.success ? "ok" : "FAIL";
          console.error(`[kota] ${event.tool}: ${status} (${event.durationMs}ms)`);
        }
        break;
      case "state_change":
        if (this.verbose) {
          console.error(`[kota] State: ${event.from} → ${event.to}`);
        }
        break;
    }
  }
}

/** No-op transport for testing or headless operation. */
export class NullTransport implements Transport {
  emit(_event: AgentEvent): void {
    // discard
  }
}

/** Mutable transport proxy — lets one session stream to different sinks per request. */
export class ProxyTransport implements Transport {
  constructor(public target: Transport = new NullTransport()) {}

  emit(event: AgentEvent): void {
    this.target.emit(event);
  }
}

/** Collects events into an array for testing or buffered output. */
export class BufferTransport implements Transport {
  readonly events: AgentEvent[] = [];

  emit(event: AgentEvent): void {
    this.events.push(event);
  }

  /** Get all text events concatenated. */
  getText(): string {
    return this.events
      .filter((e) => e.type === "text")
      .map((e) => (e as { content: string }).content)
      .join("");
  }

  /** Get all status messages. */
  getStatusMessages(): string[] {
    return this.events
      .filter((e) => e.type === "status")
      .map((e) => (e as { message: string }).message);
  }

  clear(): void {
    this.events.length = 0;
  }
}
