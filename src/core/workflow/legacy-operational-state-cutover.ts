import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RunStateDatabase } from "./run-state-database.js";

export const LEGACY_OPERATIONAL_CUTOVER_STATE_KEY =
  "runtime/legacy-operational-cutover";

type CutoverRecord = Readonly<{
  status: "prepared" | "complete";
  preparedAt: string;
  completedAt?: string;
}>;

function obsoleteOperationalPaths(projectDir: string): string[] {
  const root = join(projectDir, ".kota");
  return [
    join(root, "workflow-state.json"),
    join(root, "scope-improvement", "state.json"),
    join(root, "scope-improvement", "evidence-ready.json"),
    join(root, "task-claims"),
    join(root, "runtime-resources", "builder-port-leases.json"),
    join(root, "dispatch-paused"),
  ];
}

function decodeCutoverRecord(value: unknown): CutoverRecord | null {
  if (value === null) return null;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    value === null ||
    !("status" in value) ||
    (value.status !== "prepared" && value.status !== "complete") ||
    !("preparedAt" in value) ||
    typeof value.preparedAt !== "string" ||
    ("completedAt" in value &&
      value.completedAt !== undefined &&
      typeof value.completedAt !== "string")
  ) {
    throw new Error("Legacy operational disposal marker is invalid");
  }
  return value as CutoverRecord;
}

function removeObsoletePaths(paths: readonly string[]): void {
  for (const path of paths) rmSync(path, { recursive: true, force: true });
}

/**
 * Permanently retires pre-SQLite operational stores for one daemon-owned
 * project. This must only run against the canonical daemon database.
 */
export function disposeLegacyOperationalState(input: {
  projectDir: string;
  projectId: string;
  runState: RunStateDatabase;
  now?: () => string;
}): void {
  const now = input.now ?? (() => new Date().toISOString());
  const paths = obsoleteOperationalPaths(input.projectDir);
  const marker = input.runState.readProjectStateValue(
    input.projectId,
    LEGACY_OPERATIONAL_CUTOVER_STATE_KEY,
  );
  const record = decodeCutoverRecord(marker.value);
  const present = paths.filter(existsSync);

  if (record?.status === "complete") {
    if (present.length > 0) {
      throw new Error(
        `Obsolete operational state reappeared after disposal: ${present.join(", ")}`,
      );
    }
    return;
  }

  const prepared = record ?? { status: "prepared" as const, preparedAt: now() };
  if (record === null) {
    input.runState.compareAndSetProjectStateValue({
      projectId: input.projectId,
      key: LEGACY_OPERATIONAL_CUTOVER_STATE_KEY,
      expectedRevision: marker.revision,
      value: prepared,
      updatedAt: prepared.preparedAt,
    });
  }

  removeObsoletePaths(paths);
  const completedAt = now();
  input.runState.compareAndSetProjectStateValue({
    projectId: input.projectId,
    key: LEGACY_OPERATIONAL_CUTOVER_STATE_KEY,
    expectedRevision: record === null ? marker.revision + 1 : marker.revision,
    value: { ...prepared, status: "complete", completedAt },
    updatedAt: completedAt,
  });
}
