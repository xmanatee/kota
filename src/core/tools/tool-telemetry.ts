import { Buffer } from "node:buffer";

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

export type ToolTelemetryResultContentKind =
  | "text"
  | "blocks"
  | "structured"
  | "mixed"
  | "empty";

export type ToolTelemetryCallRecord = {
  toolUseId: string;
  tool: string;
  inputBytes: number;
  incomplete: boolean;
  truncated: boolean;
  durationMs?: number;
  success?: boolean;
  resultBytes?: number;
  resultContentKind?: ToolTelemetryResultContentKind;
};

export type ToolTelemetryCallStart = {
  toolUseId: string;
  tool: string;
  inputBytes: number;
};

export type ToolTelemetryCallResult = {
  toolUseId: string;
  tool: string;
  durationMs: number;
  success: boolean;
  resultBytes: number;
  resultContentKind: ToolTelemetryResultContentKind;
  truncated: boolean;
  error?: string;
};

export const MAX_TOOL_TELEMETRY_CALL_RECORDS = 500;

function emptyStats(): ToolStats {
  return { calls: 0, successes: 0, failures: 0, totalMs: 0, minMs: Infinity, maxMs: 0 };
}

export function measureTelemetryPayloadBytes(
  value: string | object | null | undefined,
): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") return Buffer.byteLength(value, "utf-8");
  const serialized = JSON.stringify(value);
  return serialized ? Buffer.byteLength(serialized, "utf-8") : 0;
}

export function hasToolResultTruncationMarker(
  value: string | object | null | undefined,
): boolean {
  if (value === null || value === undefined) return false;
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return text.includes("chars omitted") && text.includes("context budget tight");
}

export class ToolTelemetry {
  private stats = new Map<string, ToolStats>();
  private calls: ToolTelemetryCallRecord[] = [];
  private callIndexes = new Map<string, number>();
  private omittedCallIds = new Set<string>();
  private omittedCalls = 0;

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

  recordCallStart(call: ToolTelemetryCallStart): void {
    const existing = this.callIndexes.get(call.toolUseId);
    if (existing !== undefined) {
      this.calls[existing] = {
        ...this.calls[existing],
        tool: call.tool,
        inputBytes: call.inputBytes,
      };
      return;
    }

    if (this.calls.length >= MAX_TOOL_TELEMETRY_CALL_RECORDS) {
      if (!this.omittedCallIds.has(call.toolUseId)) {
        this.omittedCallIds.add(call.toolUseId);
        this.omittedCalls += 1;
      }
      return;
    }

    this.callIndexes.set(call.toolUseId, this.calls.length);
    this.calls.push({
      toolUseId: call.toolUseId,
      tool: call.tool,
      inputBytes: call.inputBytes,
      incomplete: true,
      truncated: false,
    });
  }

  recordCallResult(result: ToolTelemetryCallResult): void {
    const existing = this.callIndexes.get(result.toolUseId);
    if (existing !== undefined) {
      const current = this.calls[existing];
      this.calls[existing] = {
        ...current,
        tool: result.tool,
        durationMs: result.durationMs,
        success: result.success,
        resultBytes: result.resultBytes,
        resultContentKind: result.resultContentKind,
        truncated: result.truncated,
        incomplete: false,
      };
    } else if (!this.omittedCallIds.has(result.toolUseId)) {
      if (this.calls.length >= MAX_TOOL_TELEMETRY_CALL_RECORDS) {
        this.omittedCallIds.add(result.toolUseId);
        this.omittedCalls += 1;
      } else {
        this.callIndexes.set(result.toolUseId, this.calls.length);
        this.calls.push({
          toolUseId: result.toolUseId,
          tool: result.tool,
          inputBytes: 0,
          durationMs: result.durationMs,
          success: result.success,
          resultBytes: result.resultBytes,
          resultContentKind: result.resultContentKind,
          truncated: result.truncated,
          incomplete: false,
        });
      }
    }

    this.record(result.tool, result.durationMs, result.success, result.error);
  }

  getCallRecords(): readonly ToolTelemetryCallRecord[] {
    return this.calls.map((call) => ({ ...call }));
  }

  getOmittedCallCount(): number {
    return this.omittedCalls;
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
    this.calls = [];
    this.callIndexes.clear();
    this.omittedCallIds.clear();
    this.omittedCalls = 0;
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
