import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActiveRunHandle } from "./active-run-handle.js";
import type { WorkflowRunMetadata } from "./run-types.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function finish(metadata: WorkflowRunMetadata): WorkflowRunMetadata {
  const root = mkdtempSync(join(tmpdir(), "kota-active-run-usage-"));
  roots.push(root);
  const handle = createActiveRunHandle({
    id: metadata.id,
    projectDir: root,
    runDirPath: join(root, metadata.runDir),
    metadata,
    headSha: null,
  });
  return handle.finish({ status: "failed", durationMs: 60_000 });
}

describe("active run usage accounting", () => {
  it("persists measured tokens as a partial lower bound when one agent step is unknown", () => {
    const metadata: WorkflowRunMetadata = {
      id: "run-1",
      workflow: "builder",
      definitionPath: "workflow.ts",
      trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
      startedAt: "2026-08-11T00:00:00.000Z",
      status: "running",
      runDir: ".kota/runs/run-1",
      steps: [
        {
          id: "build",
          type: "agent",
          status: "success",
          startedAt: "2026-08-11T00:00:00.000Z",
          completedAt: "2026-08-11T00:01:00.000Z",
          durationMs: 60_000,
          usage: {
            tokens: { state: "complete", inputTokens: 92_328, outputTokens: 3_189 },
            cost: { state: "unavailable", reason: "provider-does-not-report" },
          },
        },
        {
          id: "critic",
          type: "agent",
          status: "failed",
          startedAt: "2026-08-11T00:01:00.000Z",
          completedAt: "2026-08-11T00:02:00.000Z",
          durationMs: 60_000,
          usage: {
            tokens: { state: "unknown" },
            cost: { state: "unavailable", reason: "provider-does-not-report" },
          },
          error: "cancelled",
        },
      ],
    };

    const completed = finish(metadata);

    expect(completed.usage).toEqual({
      tokens: { state: "partial", inputTokens: 92_328, outputTokens: 3_189 },
      cost: { state: "unavailable", reason: "provider-does-not-report" },
    });
    expect(completed).not.toHaveProperty("inputTokens");
    expect(completed).not.toHaveProperty("outputTokens");
    expect(completed).not.toHaveProperty("totalCostUsd");
  });

  it("omits usage when no agent step executed", () => {
    const metadata: WorkflowRunMetadata = {
      id: "run-2",
      workflow: "fixture",
      definitionPath: "workflow.ts",
      trigger: { event: "runtime.idle", schemaRef: null, payload: {} },
      startedAt: "2026-08-11T00:00:00.000Z",
      status: "running",
      runDir: ".kota/runs/run-2",
      steps: [{
        id: "inspect",
        type: "code",
        status: "success",
        startedAt: "2026-08-11T00:00:00.000Z",
        completedAt: "2026-08-11T00:00:01.000Z",
        durationMs: 1_000,
      }],
    };
    expect(finish(metadata)).not.toHaveProperty("usage");
  });
});
