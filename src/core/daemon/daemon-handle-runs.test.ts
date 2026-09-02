import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DurableRunState } from "#core/workflow/run-state-types.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { buildDaemonRunHandle } from "./daemon-handle-runs.js";
import type { ScopeRuntime } from "./scope-runtime.js";

const roots: string[] = [];

function authorityRuntime(
  scopeRoot: string,
  runId: string,
  state: DurableRunState,
): ScopeRuntime {
  const durableRun = { id: runId, state };
  return {
    scope: { scopeId: "scope-a", scopeRoot },
    runStore: new WorkflowRunStore(scopeRoot, {
      authorityCriticalRunIds: () => new Set(),
      operationallyActiveRunIds: () => new Set([runId]),
    }),
    runState: {
      listRuns: () => [durableRun],
      getRun: (id: string) => id === runId ? durableRun : null,
      listPendingPublicationHeads: () => [],
    },
  } as unknown as ScopeRuntime;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("buildDaemonRunHandle metadata authority", () => {
  it("fails list when durable integration owns terminal-looking malformed evidence", () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-daemon-run-list-authority-"));
    roots.push(scopeRoot);
    const runId = "run-integrating";
    const runDir = join(scopeRoot, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({ id: runId, status: "success" }),
    );
    const runtime = authorityRuntime(scopeRoot, runId, "integrating");
    const handle = buildDaemonRunHandle(() => runtime);

    expect(() => handle.listWorkflowRuns()).toThrow(
      "Workflow run metadata authority is invalid",
    );
  });

  it("fails direct lookup when a waiting run has no metadata", () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-daemon-run-get-authority-"));
    roots.push(scopeRoot);
    const runId = "run-waiting";
    const runtime = authorityRuntime(scopeRoot, runId, "waiting");
    const handle = buildDaemonRunHandle(() => runtime);

    expect(() => handle.getWorkflowRun(runId)).toThrow(
      "metadata file is missing for an authority-critical workflow run",
    );
  });

  it("reads finalized execution metadata while durable state needs attention", () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-daemon-run-list-status-"));
    roots.push(scopeRoot);
    const runId = "run-needs-attention";
    const runDir = join(scopeRoot, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({
        id: runId,
        workflow: "builder",
        definitionPath: "workflow.ts",
        trigger: { event: "manual", schemaRef: null, payload: {} },
        startedAt: "2026-09-02T00:00:00.000Z",
        completedAt: "2026-09-02T00:01:00.000Z",
        status: "success",
        runDir: `.kota/runs/${runId}`,
        steps: [],
      }),
    );
    const runtime = authorityRuntime(scopeRoot, runId, "needs_attention");
    const handle = buildDaemonRunHandle(() => runtime);

    expect(handle.listWorkflowRuns()).toEqual([
      expect.objectContaining({ id: runId, status: "success" }),
    ]);
    expect(handle.getWorkflowRun(runId)).toEqual(
      expect.objectContaining({ id: runId, status: "success" }),
    );
  });
});
