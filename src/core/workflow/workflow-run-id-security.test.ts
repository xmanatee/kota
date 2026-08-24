import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type { BusEnvelope } from "#core/events/event-bus.js";
import { enqueueMatchingWorkflows } from "./run-executor-utils.js";
import { formatRunId } from "./run-io.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition } from "./types.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions } from "./validation.js";
import { WorkflowQueueManager } from "./workflow-queue.js";

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-run-id-security-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function workflow(name = "security-consumer"): WorkflowDefinition {
  return validateWorkflowDefinitions(
    [
      registerWorkflowDefinition(`test/${name}.ts`, {
        name,
        triggers: [{ event: "security.event" }],
        steps: [
          {
            id: "mark",
            type: "emit",
            event: `${name}.done`,
          },
        ],
      }),
    ],
    process.cwd(),
  )[0]!;
}

describe("workflow run id path safety", () => {
  let projectDir: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    projectDir = makeProjectDir();
    store = new WorkflowRunStore(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("does not let arbitrary event payload _runId control the queued run id", () => {
    const definitions = [workflow()];
    const queue = new WorkflowQueueManager({
      store,
      idempotencyStore: new IdempotencyStore(
        join(projectDir, ".kota", "idempotency"),
        "scope-test",
      ),
      getScopeId: () => "scope-test",
      getActiveBackoff: () => null,
      workflowUsesAgent: () => false,
      concurrencyLimit: () => 1,
      isActiveRun: () => false,
      getDefinitions: () => definitions,
      log: () => {},
    });
    const envelope: BusEnvelope = {
      type: "security.event",
      schemaRef: null,
      payload: {
        _runId: "../outside-run",
        detail: "untrusted event payload",
      },
    };

    enqueueMatchingWorkflows(envelope, definitions, (definition, trigger, run) =>
      queue.enqueue(definition, trigger, run),
    );

    expect(queue.getRuns()).toHaveLength(1);
    const queued = queue.getRuns()[0]!;
    expect(queued.runId).not.toBe("../outside-run");
    expect(queued.runId).toContain("security-consumer");
    expect(queued.trigger.payload).not.toHaveProperty("_runId");
  });

  it("keeps generated run ids path-safe for workflow names with separators", () => {
    const runId = formatRunId("manifest-mod/workflow");

    expect(runId).toContain("manifest-mod-workflow");
    expect(runId).not.toContain("/");
  });

  it("rejects path traversal in store-created payload _runId values", () => {
    expect(() =>
      store.createRun(workflow(), {
        event: "security.event",
        schemaRef: null,
        payload: { _runId: "../outside-run" },
      }),
    ).toThrow("path-safe segment");

    expect(existsSync(join(projectDir, ".kota", "outside-run"))).toBe(false);
  });

  it("rejects path traversal in explicit queued run ids", () => {
    expect(() =>
      store.createRun(
        workflow(),
        { event: "security.event", schemaRef: null, payload: {} },
        "nested/outside-run",
      ),
    ).toThrow("path-safe segment");

    expect(existsSync(join(projectDir, ".kota", "runs", "nested"))).toBe(false);
  });
});
