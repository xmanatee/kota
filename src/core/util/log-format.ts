/**
 * Log formatter — resolves once at init time, used by the module log API.
 *
 * Supported formats:
 *   text — human-readable prefix+message lines (default)
 *   json — newline-delimited JSON objects for log aggregators
 *
 * Format is resolved from (highest to lowest priority):
 *   1. `log.format` in KotaConfig (passed to resolveLogFormatter)
 *   2. LOG_FORMAT environment variable
 *   3. Default: "text"
 */

export type LogFormat = "text" | "json";

export type LogFormatter = (
  level: string,
  prefix: string,
  msg: string,
  data?: unknown,
) => string;

function textFormatter(level: string, prefix: string, msg: string): string {
  if (level === "warn") return `${prefix} WARN: ${msg}`;
  if (level === "error") return `${prefix} ERROR: ${msg}`;
  if (level === "debug") return `${prefix} DEBUG: ${msg}`;
  return `${prefix} ${msg}`;
}

function jsonFormatter(
  level: string,
  prefix: string,
  msg: string,
  data?: unknown,
): string {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  const match = /^\[module:(.+)\]$/.exec(prefix);
  if (match) entry.module = match[1];
  if (data !== undefined) entry.data = data;
  return JSON.stringify(entry);
}

export function resolveLogFormatter(format?: LogFormat): LogFormatter {
  const resolved: LogFormat =
    format ??
    (process.env.LOG_FORMAT === "json" ? "json" : "text");
  return resolved === "json" ? jsonFormatter : textFormatter;
}
