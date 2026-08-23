import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowQueuedRun } from "./run-types.js";
import { WorkflowRuntime } from "./runtime.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";

function queuedRun(
  runId: string,
  workflowName: string,
  event: string,
  payload: Record<string, unknown>,
  timing = 1,
): WorkflowQueuedRun {
  return {
    runId,
    workflowName,
    trigger: { event, schemaRef: null, payload },
    enqueuedAtMs: timing,
    notBeforeMs: timing,
  };
}

function workflow(
  name: string,
  triggers: RegisteredWorkflowDefinitionInput["triggers"],
): RegisteredWorkflowDefinitionInput {
  return {
    name,
    definitionPath: "src/core/workflow/workflow-queue-restoration.test.ts",
    moduleRoot: process.cwd(),
    triggers,
    steps: [{ id: "noop", type: "code", run: () => ({ ok: true }) }],
  };
}

describe("pending workflow restoration", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-queue-restore-"));
    writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");
    execFileSync("git", ["init", "-q"], { cwd: projectDir });
    execFileSync("git", ["add", ".gitignore"], { cwd: projectDir });
    execFileSync(
      "git",
      [
        "-c",
        "user.email=kota@example.invalid",
        "-c",
        "user.name=KOTA Test",
        "commit",
        "-q",
        "-m",
        "initial",
      ],
      { cwd: projectDir },
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("drops obsolete old-definition inputs and preserves current pending requests", async () => {
    const store = new WorkflowRunStore(projectDir);
    store.setPendingRuns([
      queuedRun(
        "2026-08-15T18-00-02-233Z-progress-reviewer-r9yv8n",
        "progress-reviewer",
        "autonomy.progress-review.scheduled",
        { scheduledAt: "2026-08-15T18:00:02.233Z" },
      ),
      queuedRun(
        "2026-08-15T18-10-00-000Z-builder-valid",
        "builder",
        "autonomy.queue.available",
        { actionableCount: 1 },
      ),
      queuedRun(
        "2026-08-15T18-12-21-231Z-progress-reviewer-6306a1",
        "progress-reviewer",
        "workflow.batch.flushed",
        {
          sourceEventName: "workflow.completed",
          batch: { workflow: "progress-reviewer", triggerIndex: 3 },
        },
      ),
      queuedRun(
        "2026-08-15T18-20-00-000Z-security-review-valid",
        "security-review",
        "security.review.requested",
        { idempotencyKey: "security:request:1" },
      ),
    ]);
    const logs: string[] = [];
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      runStore: store,
      idleIntervalMs: 60_000,
      onLog: (message) => logs.push(message),
      workflows: [
        workflow("progress-reviewer", [
          { event: "autonomy.progress-review.requested", queueMode: "all" },
          { event: "autonomy.progress-review.automatic", queueMode: "latest" },
        ]),
        workflow("builder", [{ event: "autonomy.queue.available" }]),
        workflow("security-review", [
          { event: "security.review.requested", queueMode: "all" },
        ]),
      ],
    });

    runtime.start("paused");

    expect(runtime.getState().pendingRuns.map((run) => run.runId)).toEqual([
      "2026-08-15T18-10-00-000Z-builder-valid",
      "2026-08-15T18-20-00-000Z-security-review-valid",
    ]);
    expect(store.readState().pendingRuns).toEqual(
      runtime.getState().pendingRuns,
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("autonomy.progress-review.scheduled"),
        expect.stringContaining("workflow.batch.flushed"),
      ]),
    );
    await runtime.stop(0);
  });

  it("preserves burst-dispatched pending runs as distinct across restart", async () => {
    const store = new WorkflowRunStore(projectDir);
    store.setPendingRuns([
      queuedRun(
        "2026-08-15T18-10-00-000Z-builder-burst-1",
        "builder",
        "autonomy.queue.available",
        { actionableCount: 2 },
      ),
      queuedRun(
        "2026-08-15T18-10-00-001Z-builder-burst-2",
        "builder",
        "autonomy.queue.available",
        { actionableCount: 2 },
      ),
    ]);
    const definition = workflow("builder", [
      { event: "autonomy.queue.available" },
    ]);
    definition.dispatchBurst = ({ trigger }) =>
      trigger.payload.actionableCount === 2 ? 2 : 1;
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      runStore: store,
      idleIntervalMs: 60_000,
      workflows: [definition],
    });

    runtime.start("paused");

    expect(runtime.getState().pendingRuns.map((run) => run.runId)).toEqual([
      "2026-08-15T18-10-00-000Z-builder-burst-1",
      "2026-08-15T18-10-00-001Z-builder-burst-2",
    ]);
    expect(store.readState().pendingRuns).toEqual(
      runtime.getState().pendingRuns,
    );
    await runtime.stop(0);
  });

  it("revalidates semantic inputs, preserves manual work, and coalesces latest runs", async () => {
    const store = new WorkflowRunStore(projectDir);
    store.setPendingRuns([
      queuedRun("manual-explicit", "semantic-review", "manual", {}),
      queuedRun("automatic-malformed", "semantic-review", "review.changed", {
        revision: "bad",
      }),
      queuedRun("automatic-consumed", "semantic-review", "review.changed", {
        revision: 1,
      }),
      queuedRun("automatic-superseded", "semantic-review", "review.changed", {
        revision: 3,
      }),
      queuedRun("automatic-current", "semantic-review", "review.changed", {
        revision: 4,
        idempotencyKey: "review:4",
      }, 4),
      queuedRun("automatic-newest", "semantic-review", "review.changed", {
        revision: 5,
        idempotencyKey: "review:5",
      }, 5),
    ]);
    const logs: string[] = [];
    const definition = workflow("semantic-review", [
      { event: "review.changed", queueMode: "latest" },
    ]);
    definition.inputSchema = {
      type: "object",
      required: ["revision"],
      properties: { revision: { type: "number" } },
    };
    definition.triggerAdmission = ({ trigger }) => {
      if (trigger.event === "manual") return { admitted: true };
      const revision = trigger.payload.revision as number;
      if (revision <= 1) {
        return { admitted: false, reason: "revision was already consumed" };
      }
      if (revision < 4) {
        return { admitted: false, reason: "revision was superseded" };
      }
      return { admitted: true };
    };
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      runStore: store,
      idleIntervalMs: 60_000,
      onLog: (message) => logs.push(message),
      workflows: [definition],
    });

    runtime.start("paused");

    expect(runtime.getState().pendingRuns, logs.join("\n")).toMatchObject([
      { runId: "manual-explicit", trigger: { event: "manual" } },
      {
        runId: "automatic-current",
        enqueuedAtMs: 4,
        notBeforeMs: 5,
        trigger: { event: "review.changed", payload: { revision: 5 } },
      },
    ]);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("payload validation failed"),
        expect.stringContaining("already consumed"),
        expect.stringContaining("superseded"),
        expect.stringContaining("Coalesced restored workflow"),
      ]),
    );
    await runtime.stop(0);
  });
});
