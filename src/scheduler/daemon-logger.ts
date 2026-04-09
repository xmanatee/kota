/**
 * Structured logger for daemon operational output.
 *
 * Writes newline-delimited JSON (NDJSON) or plain text to stderr depending on
 * the configured format. Format is resolved once at construction time from:
 *   1. explicit `format` argument passed to the constructor
 *   2. KOTA_DAEMON_LOG_FORMAT environment variable
 *   3. Default: "text"
 *
 * JSON lines have the shape:
 *   { "ts": "<ISO8601>", "level": "info|warn|error", "msg": "...", ...fields }
 */

import type { LogFormat } from "../log-format.js";

export type DaemonLogFields = {
  workflow?: string;
  runId?: string;
  event?: string;
  module?: string;
  [key: string]: unknown;
};

function resolveFormat(explicit?: LogFormat): LogFormat {
  if (explicit) return explicit;
  if (process.env.KOTA_DAEMON_LOG_FORMAT === "json") return "json";
  return "text";
}

function formatJson(
  level: string,
  msg: string,
  fields?: DaemonLogFields,
): string {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  return JSON.stringify(entry);
}

function formatText(level: string, msg: string): string {
  if (level === "warn") return `[kota-daemon] WARN: ${msg}`;
  if (level === "error") return `[kota-daemon] ERROR: ${msg}`;
  return `[kota-daemon] ${msg}`;
}

export class DaemonLogger {
  private readonly format: LogFormat;

  constructor(format?: LogFormat) {
    this.format = resolveFormat(format);
  }

  info(msg: string, fields?: DaemonLogFields): void {
    this.write("info", msg, fields);
  }

  warn(msg: string, fields?: DaemonLogFields): void {
    this.write("warn", msg, fields);
  }

  error(msg: string, fields?: DaemonLogFields): void {
    this.write("error", msg, fields);
  }

  /** Emit a plain string log line (for backward-compatible callers passing pre-formatted strings). */
  line(msg: string): void {
    this.write("info", msg);
  }

  private write(level: string, msg: string, fields?: DaemonLogFields): void {
    const line =
      this.format === "json"
        ? formatJson(level, msg, fields)
        : formatText(level, msg);
    process.stderr.write(`${line}\n`);
  }
}
