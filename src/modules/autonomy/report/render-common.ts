import type {
  AreaClassification,
  BlockerClassMix,
  QueueBalance,
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

export function classificationRole(
  classification: AreaClassification,
): "success" | "warn" | "muted" {
  switch (classification) {
    case "strategic":
      return "success";
    case "fan-out":
      return "warn";
    case "other":
      return "muted";
  }
}

export function taskClassRole(
  taskClass: QueueBalance["byTaskClass"][number]["taskClass"],
): "error" | "success" | "warn" | "info" | "muted" {
  switch (taskClass) {
    case "Safety":
      return "error";
    case "Product":
      return "success";
    case "Platform":
      return "info";
    case "Meta":
      return "warn";
    case "Unclassified":
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
    case "task-done":
      return "info";
    case "missing-section":
      return "error";
    case "malformed":
      return "error";
  }
}
