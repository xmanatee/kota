import type {
  BlockerClassMix,
  ReportPriority,
} from "./aggregate.js";

const DOLLARS_DECIMALS = 2;

export function fmtUsd(value: number): string {
  return `$${value.toFixed(DOLLARS_DECIMALS)}`;
}

export function pct(part: number, whole: number): string {
  if (whole === 0) return "0%";
  return `${Math.round((100 * part) / whole)}%`;
}

export function priorityLabel(priority: ReportPriority): string {
  return priority === "unknown" ? "—" : priority;
}

export function priorityRole(
  priority: ReportPriority,
): "error" | "warn" | "info" | "muted" {
  switch (priority) {
    case "p0":
      return "error";
    case "p1":
      return "warn";
    case "p2":
      return "info";
    default:
      return "muted";
  }
}

export function healthSeverityRole(
  severity: string,
): "error" | "warn" | "info" | "muted" {
  switch (severity) {
    case "critical":
    case "error":
      return "error";
    case "warning":
      return "warn";
    case "info":
      return "info";
    default:
      return "muted";
  }
}

export function blockerRole(
  kind: BlockerClassMix["byKind"][number]["kind"],
): "warn" | "info" | "error" | "muted" {
  switch (kind) {
    case "owner-decision":
      return "warn";
    case "operator-capture":
      return "warn";
    case "capability-installed":
      return "info";
    case "missing-section":
      return "error";
    case "malformed":
      return "error";
  }
}
