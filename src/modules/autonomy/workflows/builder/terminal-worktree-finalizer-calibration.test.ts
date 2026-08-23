import { describe, expect, it, vi } from "vitest";
import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type { WorkflowTerminalFinalizerInput } from "#core/workflow/types.js";

const { recordFailedBuilderCalibration } = vi.hoisted(() => ({
  recordFailedBuilderCalibration: vi.fn(),
}));

vi.mock("./failed-calibration-finalizer.js", () => ({
  recordFailedBuilderCalibration,
}));

import { finalizeBuilderTerminalWorktree } from "./terminal-worktree-finalizer.js";

describe("builder terminal calibration", () => {
  it("records calibration before returning for a serial workspace", async () => {
    const trigger = { event: "task.ready", schemaRef: null, payload: {} } as const;
    const input: WorkflowTerminalFinalizerInput = {
      projectDir: "/tmp/project",
      workspaceDir: "/tmp/project",
      metadata: {
        id: "builder-run",
        workflow: "builder",
        definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
        trigger,
        startedAt: "2026-08-13T11:59:00.000Z",
        completedAt: "2026-08-13T12:00:00.000Z",
        status: "failed",
        durationMs: 60_000,
        runDir: ".kota/runs/builder-run",
        steps: [
          {
            id: "prepare-worktree",
            type: "code",
            status: "success",
            startedAt: "2026-08-13T11:59:00.000Z",
            completedAt: "2026-08-13T11:59:01.000Z",
            durationMs: 1_000,
            output: { enabled: false },
          },
        ],
      },
      trigger,
      emit: vi.fn(),
      log: vi.fn(),
      runBlocking: runWorkflowBlockingOperation,
    };

    await finalizeBuilderTerminalWorktree(input);

    expect(recordFailedBuilderCalibration).toHaveBeenCalledWith(input);
  });
});
