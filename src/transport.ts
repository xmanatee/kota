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
  | { type: "cost"; summary: string; budgetPercent: number }
  | { type: "error"; message: string }
  | { type: "notification"; id: number; description: string; scheduledFor: string };

/** Receives agent events and renders them for a specific frontend. */
export interface Transport {
  emit(event: AgentEvent): void;
}

/**
 * CLI transport — renders events to stdout/stderr.
 * Reproduces the original terminal behavior exactly.
 */
export class CliTransport implements Transport {
  constructor(private verbose = false) {}

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
        const msg = `[kota] ${event.summary} — context: ${event.budgetPercent}%`;
        console.error(msg);
        break;
      }
      case "error":
        console.error(event.message);
        break;
      case "notification":
        console.error(`[reminder] ${event.description}`);
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
