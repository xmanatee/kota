import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimTask,
  markTaskClaimPendingMerge,
} from "#modules/autonomy/task-claims.js";
import {
  claimInput,
  writeTask,
} from "#modules/autonomy/task-claims-test-support.js";
import { runAttentionDigestStep } from "./step.js";

describe("attention digest workflow state recovery hints", () => {
  let projectDir: string;
  let runsDir: string;
  let emittedEvents: Array<{ event: string; payload: Record<string, unknown> }>;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-digest-recovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
    emittedEvents = [];
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("points to workflow state recovery when ready work is pending-merge claim-blocked", () => {
    mkdirSync(join(projectDir, "data", "tasks", "ready"), { recursive: true });
    writeTask(projectDir, "ready", "task-pending", "2026-06-27T00:00:00.000Z");
    const claim = claimTask(
      claimInput(
        projectDir,
        "task-pending",
        "run-pending",
        new Date("2026-06-27T00:01:00.000Z"),
      ),
    );
    expect(claim.claimed).toBe(true);
    markTaskClaimPendingMerge({
      projectDir,
      taskId: "task-pending",
      runId: "run-pending",
      workflowId: "builder",
      evidence: "builder branch is pending merge",
      now: new Date("2026-06-27T00:02:00.000Z"),
    });

    for (let i = 0; i < 10; i++) {
      runAttentionDigestStep(projectDir, runsDir, undefined, (event, payload) => {
        emittedEvents.push({ event, payload });
      });
    }

    expect(emittedEvents).toHaveLength(1);
    const text = emittedEvents[0].payload.text as string;
    expect(text).toContain("Pending-merge claim blocks queue");
    expect(text).toContain("pnpm kota workflow state-recovery list");
    expect(text).toContain(
      'pnpm kota workflow state-recovery resolve task-pending --action <release|supersede> --reason "<reason>"',
    );
  });
});
