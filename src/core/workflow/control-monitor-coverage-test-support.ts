import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkflowRunMetadata } from "./run-types.js";

export const STARTED_AT = "2026-06-22T10:00:00.000Z";
export const COMPLETED_AT = "2026-06-22T10:01:00.000Z";

export type ControlCoverageFixture = {
  workspaceRoot: string;
  runDirPath: string;
  cleanup: () => void;
};

export function createControlCoverageFixture(
  prefix = "kota-control-coverage",
): ControlCoverageFixture {
  const workspaceRoot = join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const runDirPath = join(workspaceRoot, ".kota", "runs", "run-control");
  mkdirSync(join(runDirPath, "steps"), { recursive: true });
  return {
    workspaceRoot,
    runDirPath,
    cleanup: () => rmSync(workspaceRoot, { recursive: true, force: true }),
  };
}

export function writeJson(path: string, value: object): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export function writeJsonl(path: string, values: readonly object[]): void {
  writeFileSync(
    path,
    `${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
    "utf-8",
  );
}

export function baseMetadata(
  overrides: Partial<WorkflowRunMetadata> = {},
): WorkflowRunMetadata {
  const id = overrides.id ?? "run-control";
  return {
    id,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: {},
    },
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    status: "success",
    durationMs: 60_000,
    runDir: `.kota/runs/${id}`,
    steps: [],
    ...overrides,
  };
}
