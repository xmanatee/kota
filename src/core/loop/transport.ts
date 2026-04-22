/**
 * Transport layer — decouples agent I/O from any specific frontend.
 *
 * The agent emits typed events. A Transport decides how to render them.
 * CliTransport renders events through the rendering module so theme,
 * width, and TTY detection stay consistent with the rest of KOTA.
 * Other transports (Telegram, web, Discord) subscribe to the same events.
 */

import { line, plain, span, toolCall } from "#modules/rendering/primitives.js";
import { TerminalTransport } from "#modules/rendering/transport.js";

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
 * CLI transport — renders events through the rendering module's terminal
 * transport so theme, width, and NO_COLOR/TTY gating are consistent with
 * every other operator-facing surface.
 *
 * Streaming `text`, `thinking`, and `progress` events pass through as raw
 * chunks because they accumulate mid-line; discrete events (status, cost,
 * error, guardrail, tool metrics, state transitions) render as typed
 * primitives.
 */
export class CliTransport implements Transport {
  private verbose: boolean;
  private showCost: boolean;
  private stdout: TerminalTransport;
  private stderr: TerminalTransport;

  constructor(verbose = false, showCost = true) {
    this.verbose = verbose;
    this.showCost = showCost;
    this.stdout = new TerminalTransport({ stream: process.stdout });
    this.stderr = new TerminalTransport({ stream: process.stderr });
  }

  emit(event: AgentEvent): void {
    switch (event.type) {
      case "text":
        this.stdout.writeRaw(event.content);
        break;
      case "thinking":
        if (this.verbose) this.stderr.writeRaw(event.content);
        break;
      case "thinking_start":
        if (this.verbose) {
          this.stderr.writeRaw("[thinking] ");
        } else {
          this.stderr.writeRaw("[kota] Thinking...\n");
        }
        break;
      case "progress":
        this.stderr.writeRaw(event.content);
        break;
      case "status":
        this.stderr.write(line(plain(event.message)));
        break;
      case "cost": {
        if (!this.showCost) break;
        const msg =
          event.turn !== undefined && event.turnCostUsd !== undefined && event.totalCostUsd !== undefined
            ? `[kota] Turn ${event.turn} — $${event.turnCostUsd.toFixed(4)} this turn · $${event.totalCostUsd.toFixed(4)} total — context: ${event.budgetPercent}%`
            : `[kota] ${event.summary} — context: ${event.budgetPercent}%`;
        this.stderr.write(line(span(msg, "muted")));
        break;
      }
      case "error":
        this.stderr.write(line(span(event.message, "error")));
        break;
      case "notification":
        this.stderr.write(line(span(`[reminder] ${event.description}`, "accent")));
        break;
      case "guardrail":
        if (event.policy !== "allow") {
          this.stderr.write(
            line(
              span(
                `[guardrail] ${event.tool}: ${event.policy} (${event.risk} — ${event.reason})`,
                "warn",
              ),
            ),
          );
        } else if (this.verbose) {
          this.stderr.write(
            line(span(`[guardrail] ${event.tool}: ${event.policy} (${event.risk})`, "muted")),
          );
        }
        break;
      case "tool_metric":
        if (this.verbose) {
          this.stderr.write(
            toolCall(event.tool, event.success ? "success" : "error", {
              summary: `${event.durationMs}ms`,
            }),
          );
        }
        break;
      case "state_change":
        if (this.verbose) {
          this.stderr.write(line(span(`[kota] State: ${event.from} → ${event.to}`, "muted")));
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
