import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { installAwaitResumers } from "./awaits-resume.js";
import {
  type AwaitDelivery,
  readSuspension,
} from "./awaits-store.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

function makeAwaitDefinition(): WorkflowDefinition {
  return {
    name: "test-await",
    enabled: true,
    recoveryCapable: false,
    definitionPath: "src/modules/test/workflows/test-await/workflow.ts",
    moduleRoot: "/test-module-root",
    triggers: [],
    steps: [
      {
        id: "seed",
        type: "code",
        run: () => ({ questionId: "q-42" }),
      },
      {
        id: "wait-answer",
        type: "await-event",
        event: "operator.answer",
        matchField: "questionId",
        matchValue: "q-42",
        awaitTimeoutMs: 60_000,
      },
      {
        id: "consume",
        type: "code",
        run: (ctx) => {
          const out = ctx.stepOutputs["wait-answer"] as
            | { kind: "event"; payload: Record<string, unknown> }
            | { kind: "timeout" };
          return { resolution: out.kind, output: out };
        },
      },
    ],
    tags: [],
  };
}

const TRIGGER: WorkflowRunTrigger = { event: "manual", schemaRef: null, payload: {} };

describe("await-event step", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-await-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("(a) live: event arrives while the daemon is alive — step resolves and the workflow continues", async () => {
    const definition = makeAwaitDefinition();
    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });

    // Fire the matching event after a short delay so the await is registered first.
    setTimeout(() => {
      bus.emit("operator.answer", { questionId: "q-42", answer: "approve" });
    }, 10);

    const result = await promise;
    expect(result.metadata.status).toBe("success");

    const consume = result.metadata.steps.find((s) => s.id === "consume");
    expect(consume).toBeDefined();
    expect(consume!.status).toBe("success");
    const output = consume!.output as {
      resolution: string;
      output: { kind: string; payload?: { answer?: string } };
    };
    expect(output.resolution).toBe("event");
    expect(output.output.kind).toBe("event");
    expect(output.output.payload?.answer).toBe("approve");

    // Suspension and delivery files cleaned up after live success.
    const runDir = join(store.runsDir, result.metadata.id);
    expect(existsSync(join(runDir, "awaits", "wait-answer.json"))).toBe(false);
    expect(existsSync(join(runDir, "awaits", "wait-answer.delivered.json"))).toBe(false);
  });

  it("(b) restart-resume from buffered delivery: daemon was down when the answer arrived", async () => {
    // Phase 1: start the run, abort mid-await to simulate a daemon crash.
    const definition = makeAwaitDefinition();
    const abort = new AbortController();
    const { promise } = executeWorkflowRun(
      definition,
      TRIGGER,
      { projectDir, bus, store, log },
      abort,
    );
    // Wait for the suspension file to be written, then abort.
    let suspendedRunId = "";
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise((r) => setTimeout(r, 5));
      const dirs = readdirSync(store.runsDir);
      for (const dir of dirs) {
        if (existsSync(join(store.runsDir, dir, "awaits", "wait-answer.json"))) {
          suspendedRunId = dir;
          break;
        }
      }
      if (suspendedRunId) break;
    }
    expect(suspendedRunId).not.toBe("");

    abort.abort(new Error("simulated daemon stop"));
    const interruptedResult = await promise;
    expect(interruptedResult.metadata.status).toBe("interrupted");

    // Suspension file still present after the interruption.
    const runDir = join(store.runsDir, suspendedRunId);
    expect(readSuspension(runDir, "wait-answer")).toBeTruthy();

    // Simulate "event arrived during the gap": an external producer writes
    // the delivery sibling. (Producers persisting answers durably during a
    // daemon-down gap is the contract this primitive offers.)
    const delivery: AwaitDelivery = {
      kind: "event",
      deliveredAt: new Date().toISOString(),
      event: "operator.answer",
      payload: { questionId: "q-42", answer: "from-buffered" },
    };
    writeFileSync(
      join(runDir, "awaits", "wait-answer.delivered.json"),
      JSON.stringify(delivery, null, 2),
      "utf-8",
    );

    // Phase 2: simulate daemon restart by calling recoverInterruptedRuns +
    // installAwaitResumers, then dispatching the queued resume run.
    store.recoverInterruptedRuns();
    let scheduled = 0;
    const newBus = new EventBus();
    installAwaitResumers({
      bus: newBus,
      store,
      definitions: [definition],
      log,
      appendResumeRun: (q) => {
        const s = store.readState();
        if (s.pendingRuns.some((r) => r.runId === q.runId)) return;
        store.setPendingRuns([...s.pendingRuns, q]);
      },
      onScheduled: () => { scheduled += 1; },
    });
    expect(scheduled).toBe(1);

    const queued = store.readState().pendingRuns;
    expect(queued).toHaveLength(1);
    const resumeQueued = queued[0];
    expect(resumeQueued.workflowName).toBe("test-await");
    expect(resumeQueued.trigger.event).toBe("resume");

    // Drain the queue: dispatch the queued resume run.
    store.setPendingRuns([]);
    const resumed = await executeWorkflowRun(
      definition,
      resumeQueued.trigger,
      { projectDir, bus: newBus, store, log },
    ).promise;
    expect(resumed.metadata.status).toBe("success");
    expect(resumed.metadata.resumedFromRunId).toBe(suspendedRunId);

    const consume = resumed.metadata.steps.find((s) => s.id === "consume");
    expect(consume?.status).toBe("success");
    const output = consume!.output as {
      resolution: string;
      output: { kind: string; payload?: { answer?: string } };
    };
    expect(output.resolution).toBe("event");
    expect(output.output.payload?.answer).toBe("from-buffered");
  });

  it("(c) restart-resume on timeout: daemon restart, no event, deadline already passed", async () => {
    // Phase 1: start the run with a tight deadline, abort before the timer fires.
    const definition = makeAwaitDefinition();
    // Override awaitTimeoutMs in the registered step to a short window.
    (definition.steps[1] as { awaitTimeoutMs: number }).awaitTimeoutMs = 50;

    const abort = new AbortController();
    const { promise } = executeWorkflowRun(
      definition,
      TRIGGER,
      { projectDir, bus, store, log },
      abort,
    );
    let suspendedRunId = "";
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise((r) => setTimeout(r, 5));
      const dirs = readdirSync(store.runsDir);
      for (const dir of dirs) {
        if (existsSync(join(store.runsDir, dir, "awaits", "wait-answer.json"))) {
          suspendedRunId = dir;
          break;
        }
      }
      if (suspendedRunId) break;
    }
    expect(suspendedRunId).not.toBe("");

    abort.abort(new Error("simulated daemon stop"));
    await promise;

    // Wait until the deadline is in the past — no buffered event arrives.
    await new Promise((r) => setTimeout(r, 60));

    // Phase 2: simulate daemon restart.
    store.recoverInterruptedRuns();
    let scheduled = 0;
    const newBus = new EventBus();
    installAwaitResumers({
      bus: newBus,
      store,
      definitions: [definition],
      log,
      appendResumeRun: (q) => {
        const s = store.readState();
        if (s.pendingRuns.some((r) => r.runId === q.runId)) return;
        store.setPendingRuns([...s.pendingRuns, q]);
      },
      onScheduled: () => { scheduled += 1; },
    });
    expect(scheduled).toBe(1);

    const queued = store.readState().pendingRuns;
    expect(queued).toHaveLength(1);
    store.setPendingRuns([]);

    const resumed = await executeWorkflowRun(
      definition,
      queued[0].trigger,
      { projectDir, bus: newBus, store, log },
    ).promise;
    expect(resumed.metadata.status).toBe("success");

    const consume = resumed.metadata.steps.find((s) => s.id === "consume");
    expect(consume?.status).toBe("success");
    const output = consume!.output as {
      resolution: string;
      output: { kind: string; awaitTimeoutMs?: number };
    };
    expect(output.resolution).toBe("timeout");
    expect(output.output.kind).toBe("timeout");
    expect(output.output.awaitTimeoutMs).toBe(50);
  });
});
