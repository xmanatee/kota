/**
 * Tool execution telemetry — tracks per-tool timing, success/failure rates,
 * and error patterns across a session. Cross-cutting infrastructure that
 * makes tool performance visible without touching individual tool code.
 */

type ToolStats = {
  calls: number;
  successes: number;
  failures: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  lastError?: string;
};

function emptyStats(): ToolStats {
  return { calls: 0, successes: 0, failures: 0, totalMs: 0, minMs: Infinity, maxMs: 0 };
}

export class ToolTelemetry {
  private stats = new Map<string, ToolStats>();

  record(name: string, durationMs: number, success: boolean, error?: string): void {
    let s = this.stats.get(name);
    if (!s) {
      s = emptyStats();
      this.stats.set(name, s);
    }
    s.calls++;
    if (success) s.successes++;
    else s.failures++;
    s.totalMs += durationMs;
    if (durationMs < s.minMs) s.minMs = durationMs;
    if (durationMs > s.maxMs) s.maxMs = durationMs;
    if (error) s.lastError = error.slice(0, 200);
  }

  getStats(): ReadonlyMap<string, Readonly<ToolStats>> {
    return this.stats;
  }

  getToolStats(name: string): Readonly<ToolStats> | undefined {
    return this.stats.get(name);
  }

  getTotalCalls(): number {
    let total = 0;
    for (const s of this.stats.values()) total += s.calls;
    return total;
  }

  getTotalFailures(): number {
    let total = 0;
    for (const s of this.stats.values()) total += s.failures;
    return total;
  }

  /** Compact summary for dynamic system state. Empty string if no data. */
  getSummary(): string {
    if (this.stats.size === 0) return "";
    let totalCalls = 0;
    let totalFails = 0;
    let totalMs = 0;
    for (const s of this.stats.values()) {
      totalCalls += s.calls;
      totalFails += s.failures;
      totalMs += s.totalMs;
    }
    const avgMs = totalCalls > 0 ? Math.round(totalMs / totalCalls) : 0;
    let summary = `${totalCalls} tool calls, ${totalCalls - totalFails} ok`;
    if (totalFails > 0) summary += `, ${totalFails} failed`;
    summary += `, avg ${avgMs}ms`;

    if (totalFails > 0) {
      const failedTools = [...this.stats.entries()]
        .filter(([, s]) => s.failures > 0)
        .map(([name, s]) => `${name}: ${s.failures}/${s.calls} fail`)
        .join(", ");
      summary += ` | ${failedTools}`;
    }
    return summary;
  }

  /** Detailed per-tool breakdown. */
  getDetailedSummary(): string {
    if (this.stats.size === 0) return "No tool calls recorded.";
    const lines: string[] = [];
    const sorted = [...this.stats.entries()].sort((a, b) => b[1].calls - a[1].calls);
    for (const [name, s] of sorted) {
      const avg = s.calls > 0 ? Math.round(s.totalMs / s.calls) : 0;
      let line = `${name}: ${s.calls} calls, ${s.successes} ok, ${s.failures} fail, avg ${avg}ms`;
      if (s.calls > 1) line += ` (${s.minMs}-${s.maxMs}ms)`;
      if (s.lastError) line += ` — last error: ${s.lastError}`;
      lines.push(line);
    }
    return lines.join("\n");
  }

  /** Compact tool-call summary array, sorted by call count descending. Undefined if no calls recorded. */
  toToolCallSummary(): Array<{ tool: string; count: number; totalMs: number }> | undefined {
    if (this.stats.size === 0) return undefined;
    return [...this.stats.entries()]
      .sort((a, b) => b[1].calls - a[1].calls)
      .map(([tool, s]) => ({ tool, count: s.calls, totalMs: s.totalMs }));
  }

  reset(): void {
    this.stats.clear();
  }
}

// Session-scoped singleton
let _telemetry: ToolTelemetry | null = null;

export function getToolTelemetry(): ToolTelemetry {
  if (!_telemetry) _telemetry = new ToolTelemetry();
  return _telemetry;
}

export function resetToolTelemetry(): void {
  _telemetry = null;
}
