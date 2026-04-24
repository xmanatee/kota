/**
 * CLI transport — renders agent events through the rendering module's
 * terminal transport so theme, width, and NO_COLOR/TTY gating are
 * consistent with every other operator-facing surface.
 *
 * Streaming `text`, `thinking`, and `progress` events pass through as
 * raw chunks because they accumulate mid-line; discrete events (status,
 * cost, error, guardrail, tool metrics, state transitions) render as
 * typed primitives.
 *
 * This transport lives in the rendering module, not in core. Core owns
 * the neutral `Transport` / `AgentEvent` contract in
 * `src/core/loop/transport.ts`; module-owned transports bind that
 * contract to a specific frontend.
 */

import type { AgentEvent, Transport } from "#core/loop/transport.js";
import { line, plain, span, toolCall } from "./primitives.js";
import { TerminalTransport } from "./transport.js";

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
