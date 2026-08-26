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

describe("active run usage accounting", () => {
  it("includes repair usage preserved inside a failed step output", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-active-run-usage-"));
    roots.push(root);
    const runDirPath = join(root, ".kota", "runs", "run-1");
    const metadata: WorkflowRunMetadata = {
      id: "run-1",
      workflow: "builder",
      definitionPath: "workflow.ts",
      trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
      startedAt: "2026-08-11T00:00:00.000Z",
      status: "running",
      runDir: ".kota/runs/run-1",
      steps: [{
        id: "build",
        type: "agent",
        status: "failed",
        startedAt: "2026-08-11T00:00:00.000Z",
        completedAt: "2026-08-11T00:01:00.000Z",
        durationMs: 60_000,
        output: { inputTokens: 92_328, outputTokens: 3_189 },
        error: "repair made no progress",
      }],
    };
    const handle = createActiveRunHandle({
      id: metadata.id,
      projectDir: root,
      runDirPath,
      metadata,
      headSha: null,
    });

    expect(handle.finish({ status: "failed", durationMs: 60_000 })).toMatchObject({
      inputTokens: 92_328,
      outputTokens: 3_189,
    });
  });
});
