import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { enumerateCompletedWorkflowRunMetadata } from "./run-operational-projection.js";
import { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition } from "./types.js";

it("selects settled outcomes while another run starts and publishes its evidence", () => {
  const scopeRoot = mkdtempSync(join(tmpdir(), "kota-completed-runs-"));
  const stateDir = join(scopeRoot, ".kota");
  const database = new RunStateDatabase(stateDir);
  const store = new WorkflowRunStore(scopeRoot);
  const now = "2026-09-12T11:12:50.000Z";
  const workflow: WorkflowDefinition = {
    name: "observer-source", repository: "none", enabled: true, tags: [],
    definitionPath: "workflow.ts", moduleRoot: scopeRoot, triggers: [], steps: [],
  };
  const trigger = { event: "manual", schemaRef: null, payload: {} } as const;
  try {
    database.registerScope({ id: "scope", rootPath: scopeRoot, createdAt: now });
    const { epoch } = database.beginDaemonSession(now);
    const start = (id: string) => {
      database.admitRun({ id, scopeId: "scope", workflow: workflow.name,
        repository: "none", trigger, resources: [], admittedAt: now });
      database.startRun(id, epoch, now);
    };
    const observe = () => enumerateCompletedWorkflowRunMetadata({
      runsDir: store.runsDir, authority: { stateDir, scopeRoot },
    }).runs.map((run) => ({ id: run.id, status: run.status }));
    start("completed");
    store.createRun(workflow, trigger, "completed").finish({ status: "failed", durationMs: 1 });
    database.finishRun("completed", epoch, "failed", now);
    const baseline = [{ id: "completed", status: "failed" }];
    expect(observe()).toEqual(baseline);

    start("starting");
    // Durable admission precedes artifact creation; then workflow/trigger appear
    // before metadata. Both are real externally observable startup interleavings.
    expect(observe()).toEqual(baseline);
    const startingDir = join(store.runsDir, "starting");
    mkdirSync(startingDir);
    writeFileSync(join(startingDir, "trigger.json"), JSON.stringify(trigger));
    expect(observe()).toEqual(baseline);
    const starting = store.createRun(workflow, trigger, "starting");
    expect(observe()).toEqual(baseline);
    starting.finish({ status: "success", durationMs: 1 });
    const evidence = readFileSync(join(startingDir, "metadata.json"), "utf8");
    // Finished workflow execution can still be awaiting runtime publication.
    expect(observe()).toEqual(baseline);
    database.finishRun("starting", epoch, "succeeded", now, undefined, {
      id: "starting-completed", runId: "starting", scopeId: "scope",
      event: "workflow.completed", payload: { runId: "starting" },
    });
    expect(observe()).toEqual(baseline);
    database.markPublicationDelivered("starting-completed", now);
    expect(observe()).toEqual([...baseline, { id: "starting", status: "success" }]);
    expect(readFileSync(join(startingDir, "metadata.json"), "utf8")).toBe(evidence);
    database.pruneTerminalRuns({ finishedBefore: now });
    expect(observe()).toEqual([...baseline, { id: "starting", status: "success" }]);
  } finally {
    database.close();
    rmSync(scopeRoot, { recursive: true, force: true });
  }
});
