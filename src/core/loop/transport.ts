/**
 * Transport layer — decouples agent I/O from any specific frontend.
 *
 * The agent emits typed events. A `Transport` decides how to render them.
 * Core owns the neutral shape: the `AgentEvent` discriminated union, the
 * `Transport` interface, plus three protocol-only implementations
 * (`NullTransport`, `ProxyTransport`, `BufferTransport`) that every
 * non-CLI caller already depends on.
 *
 * CLI rendering is module-owned. The `rendering` module registers a
 * `RenderingProvider` on load that the loop constructor uses to build
 * the default operator-facing transport. Deployments that omit the
 * rendering module degrade to `NullTransport` rather than failing at
 * load time. See `src/core/modules/no-rendering-imports-in-core.test.ts`.
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
