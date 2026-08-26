import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { getPreset } from "#core/model/preset.js";
import { WorkflowEventBatchManager } from "#core/workflow/event-batches.js";
import { enqueueMatchingWorkflows } from "#core/workflow/run-executor-utils.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { validateWorkflowDefinitions } from "#core/workflow/validation.js";
import {
  autonomyWorkflowInputs,
  CAPTURE_DIR,
  type CompletionCapture,
  completionEnvelope,
  invocationFromTrigger,
  REMOVED_ESCALATORS,
  REPO_ROOT,
  type RoutedInvocation,
  readJson,
} from "./production-routing-replay.integration-test-helpers.js";

import "#modules/claude-agent-harness/index.js";

describe("production completion routing replay", () => {
  const tempDirs: string[] = [];
  const expectedCompletionConsumers = [
    "attention-digest",
    "evaluator-calibration-monitor",
    "fan-out-consolidator",
  ];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("routes the exact latest-200 capture without completion-wide escalator or improver runs", async () => {
    const capture = readJson<CompletionCapture>(
      join(CAPTURE_DIR, "latest-200-workflow-completions.json"),
    );
    expect(capture.rows).toHaveLength(200);
    expect(capture.verification.rowCount).toBe(capture.rows.length);
    expect(
      createHash("sha256").update(JSON.stringify(capture.rows)).digest("hex"),
    ).toBe(capture.verification.rowSha256);
    expect(capture.verification.removedEscalatorRuns).toBe(92);
    expect(capture.verification.workflowCounts.improver).toBe(10);
    const historicalProgress = capture.rows.filter(
      (row) => row.workflow === "progress-reviewer",
    );
    const historicalScope = capture.rows.filter(
      (row) => row.workflow === "scope-improver",
    );
    expect(historicalProgress).toHaveLength(17);
    expect(historicalScope).toHaveLength(4);
    expect(historicalProgress.reduce((total, row) => total + row.durationMs, 0))
      .toBe(1_998_830);
    expect(historicalScope.reduce((total, row) => total + row.durationMs, 0))
      .toBe(3_778);

    const rawDefinitions = await autonomyWorkflowInputs();
    const definitions = validateWorkflowDefinitions(rawDefinitions, REPO_ROOT, {
      defaultAgentHarness: "claude-agent-sdk",
      preset: getPreset("claude"),
    });
    expect(definitions.map((definition) => definition.name)).not.toEqual(
      expect.arrayContaining([...REMOVED_ESCALATORS]),
    );
    expect(
      definitions.find((definition) => definition.name === "improver")?.triggers,
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "workflow.completed" }),
      ]),
    );
    for (const workflowName of ["progress-reviewer", "scope-improver"]) {
      const triggers = definitions.find(
        (definition) => definition.name === workflowName,
      )?.triggers ?? [];
      expect(triggers.some((trigger) => trigger.schedule || trigger.batch))
        .toBe(false);
      expect(triggers.some((trigger) =>
        trigger.event === "workflow.completed" ||
        trigger.event === "workflow.build.committed"
      )).toBe(false);
    }

    const replayDir = mkdtempSync(join(tmpdir(), "kota-routing-window-"));
    tempDirs.push(replayDir);
    const scopeId = "8nrg1m";
    const bus = new EventBus();
    const pbus = new ScopedEventBus(bus, scopeId);
    const store = new WorkflowRunStore(replayDir);
    const invocations: RoutedInvocation[] = [];
    const recordInvocation = (
      definition: WorkflowDefinition,
      _trigger: WorkflowDefinition["triggers"][number],
      run: WorkflowRunTrigger,
    ) => invocations.push(invocationFromTrigger(definition.name, run));
    const batches = new WorkflowEventBatchManager(
      store,
      () => false,
      recordInvocation,
      () => {},
      () => pbus,
      () => {},
    );
    batches.setup(definitions);
    try {
      for (const row of capture.rows) {
        const envelope = completionEnvelope(row, scopeId);
        batches.handleEvent(envelope);
        enqueueMatchingWorkflows(envelope, definitions, recordInvocation);
      }
      const pendingInputs = Object.values(store.getBatchBuffers()).reduce(
        (total, buffer) => total + buffer.inputEvents.length,
        0,
      );

      expect(
        [...new Set(invocations.map((run) => run.workflow))].sort(),
      ).toEqual(expectedCompletionConsumers);
      expect(pendingInputs).toBe(0);
      expect(
        invocations.filter((run) =>
          REMOVED_ESCALATORS.includes(
            run.workflow as (typeof REMOVED_ESCALATORS)[number],
          )
        ),
      ).toEqual([]);
      expect(invocations.filter((run) => run.workflow === "improver")).toEqual([]);
    } finally {
      batches.clearAll();
    }
  });
});
