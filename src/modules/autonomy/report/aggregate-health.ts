import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  type AutonomyHealthJsonObject,
  type AutonomyHealthJsonValue,
  isAutonomyHealthJsonObject,
} from "#modules/autonomy/health-signal.js";
import type {
  AutonomyHealthBreakdown,
  HealthCountRow,
  HealthTopGroup,
} from "./aggregate-types.js";

export function buildAutonomyHealthBreakdown(
  runsDir: string,
  windowStartMs: number,
  windowEndMs: number,
): AutonomyHealthBreakdown {
  const bySeverity = new Map<string, number>();
  const byLabel = new Map<string, number>();
  const byScope = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byActionability = new Map<string, number>();
  const topGroups: HealthTopGroup[] = [];
  let totalSignals = 0;
  let totalGroups = 0;

  if (!existsSync(runsDir)) {
    return emptyAutonomyHealthBreakdown();
  }

  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const artifact = readHealthReviewArtifact(
      join(runsDir, entry.name, "autonomy-health-review.json"),
    );
    if (!artifact) continue;
    const generatedAtMs = Date.parse(stringField(artifact.generatedAt, ""));
    if (
      Number.isNaN(generatedAtMs) ||
      generatedAtMs < windowStartMs ||
      generatedAtMs > windowEndMs
    ) {
      continue;
    }
    const review = isAutonomyHealthJsonObject(artifact.review)
      ? artifact.review
      : undefined;
    const scopeObj = isAutonomyHealthJsonObject(review?.scope)
      ? review.scope
      : undefined;
    const scope = stringField(
      scopeObj?.scopeId ?? scopeObj?.projectId,
      "(unknown)",
    );
    const groups = Array.isArray(review?.groups) ? review.groups : [];
    for (const rawGroup of groups) {
      const group = decodeHealthReportGroup(rawGroup, scope);
      if (!group) continue;
      totalSignals += group.signalCount;
      totalGroups += 1;
      countMapAdd(bySeverity, group.severity, group.signalCount);
      countMapAdd(byScope, group.scope, group.signalCount);
      countMapAdd(bySource, group.source, group.signalCount);
      countMapAdd(byActionability, group.actionability, group.signalCount);
      for (const label of group.labels) {
        countMapAdd(byLabel, label, group.signalCount);
      }
      topGroups.push(group);
    }
  }

  return {
    totalSignals,
    totalGroups,
    bySeverity: countRows(bySeverity, "severity"),
    byLabel: countRows(byLabel, "label"),
    byScope: countRows(byScope, "scope"),
    bySource: countRows(bySource, "source"),
    byActionability: countRows(byActionability, "actionability"),
    topGroups: topGroups
      .sort(
        (a, b) =>
          b.signalCount - a.signalCount || a.dedupeKey.localeCompare(b.dedupeKey),
      )
      .slice(0, 10),
  };
}

function emptyAutonomyHealthBreakdown(): AutonomyHealthBreakdown {
  return {
    totalSignals: 0,
    totalGroups: 0,
    bySeverity: [],
    byLabel: [],
    byScope: [],
    bySource: [],
    byActionability: [],
    topGroups: [],
  };
}

function readHealthReviewArtifact(path: string): AutonomyHealthJsonObject | null {
  const raw = readOptionalJsonFile<AutonomyHealthJsonValue>(path);
  return isAutonomyHealthJsonObject(raw) ? raw : null;
}

function stringField(
  value: AutonomyHealthJsonValue | undefined,
  fallback: string,
): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function stringArray(value: AutonomyHealthJsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function nonEmptyString(value: AutonomyHealthJsonValue | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function countMapAdd(map: Map<string, number>, key: string, count: number): void {
  map.set(key, (map.get(key) ?? 0) + count);
}

function countRows<TKey extends string>(
  map: Map<string, number>,
  key: TKey,
): HealthCountRow<TKey>[] {
  return [...map.entries()]
    .map(([label, count]) => ({ [key]: label, count }) as HealthCountRow<TKey>)
    .sort((a, b) => b.count - a.count || a[key].localeCompare(b[key]));
}

function decodeHealthReportGroup(
  rawGroup: AutonomyHealthJsonValue | undefined,
  scope: string,
): HealthTopGroup | null {
  if (!isAutonomyHealthJsonObject(rawGroup)) return null;
  const signalCount =
    typeof rawGroup.signalCount === "number" && rawGroup.signalCount > 0
      ? rawGroup.signalCount
      : null;
  const severity = nonEmptyString(rawGroup.severity);
  const actionability = nonEmptyString(rawGroup.actionability);
  const dedupeKey = nonEmptyString(rawGroup.dedupeKey);
  const sourceObj = isAutonomyHealthJsonObject(rawGroup.source)
    ? rawGroup.source
    : null;
  const sourceKind = sourceObj ? nonEmptyString(sourceObj.kind) : null;
  const sourceId = sourceObj ? nonEmptyString(sourceObj.id) : null;
  if (
    signalCount === null ||
    severity === null ||
    actionability === null ||
    dedupeKey === null ||
    sourceKind === null ||
    sourceId === null
  ) {
    return null;
  }
  return {
    dedupeKey,
    labels: stringArray(rawGroup.labels),
    severity,
    actionability,
    signalCount,
    source: `${sourceKind}:${sourceId}`,
    scope,
  };
}
