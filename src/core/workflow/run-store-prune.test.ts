import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition } from "./types.js";

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-prune-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(dir, ".kota", "runs"), { recursive: true });
  return dir;
}

function writeRun(
  runsDir: string,
  id: string,
  workflow: string,
  startedAtMs: number,
): void {
  const runDir = join(runsDir, id);
  mkdirSync(runDir, { recursive: true });
  const metadata = {
    id,
    workflow,
    definitionPath: `src/modules/test/workflows/${workflow}/workflow.ts`,
    trigger: { event: "runtime.idle", schemaRef: null, payload: {} },
    startedAt: new Date(startedAtMs).toISOString(),
    status: "success",
    completedAt: new Date(startedAtMs + 1000).toISOString(),
    durationMs: 1000,
    runDir: `.kota/runs/${id}`,
    steps: [],
  };
  writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata));
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("WorkflowRunStore.pruneRuns", () => {
  let projectDir: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    projectDir = makeProjectDir();
    store = new WorkflowRunStore(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns empty array when there are no runs", () => {
    const deleted = store.pruneRuns();
    expect(deleted).toEqual([]);
  });

  it("does not delete runs within the retention window", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    writeRun(runsDir, "run-recent", "builder", Date.now() - DAY_MS);
    const deleted = store.pruneRuns({ retentionDays: 7 });
    expect(deleted).toEqual([]);
    expect(existsSync(join(runsDir, "run-recent"))).toBe(true);
  });

  it("deletes runs older than retentionDays beyond minKeepPerWorkflow", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    const now = Date.now();
    // 10 recent runs (within retention)
    for (let i = 0; i < 10; i++) {
      writeRun(runsDir, `run-new-${i}`, "builder", now - (i + 1) * DAY_MS);
    }
    // 3 old runs (beyond retention AND beyond minKeep)
    for (let i = 0; i < 3; i++) {
      writeRun(runsDir, `run-old-${i}`, "builder", now - (20 + i) * DAY_MS);
    }
    const deleted = store.pruneRuns({ retentionDays: 7, minKeepPerWorkflow: 10 });
    expect(deleted).toHaveLength(3);
    for (const id of deleted) {
      expect(existsSync(join(runsDir, id))).toBe(false);
    }
    const references = readFileSync(join(runsDir, "pruned-runs.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as {
        artifactType: string;
        id: string;
        payloadExpired: boolean;
        retained: { workflow: string; status: string };
        provenance: { workflowName: string; runId: string };
      });
    expect(references).toHaveLength(3);
    expect(references[0]).toMatchObject({
      artifactType: "workflow-run",
      payloadExpired: true,
      retained: { workflow: "builder", status: "success" },
      provenance: { workflowName: "builder" },
    });
    // Recent runs untouched
    for (let i = 0; i < 10; i++) {
      expect(existsSync(join(runsDir, `run-new-${i}`))).toBe(true);
    }
  });

  it("uses evidence-policy terminal run retention when retentionDays is omitted", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    const now = Date.now();
    writeRun(runsDir, "run-recent", "builder", now - 6 * DAY_MS);
    writeRun(runsDir, "run-old", "builder", now - 8 * DAY_MS);

    const deleted = store.pruneRuns({ minKeepPerWorkflow: 0 });

    expect(deleted).toEqual(["run-old"]);
    expect(existsSync(join(runsDir, "run-recent"))).toBe(true);
    expect(existsSync(join(runsDir, "run-old"))).toBe(false);
  });

  it("respects minKeepPerWorkflow — keeps N newest even if older than retention", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    const now = Date.now();
    // 5 old runs, all beyond retention
    for (let i = 0; i < 5; i++) {
      writeRun(runsDir, `run-old-${i}`, "builder", now - (10 + i) * DAY_MS);
    }
    // minKeepPerWorkflow = 5 → keep all of them
    const deleted = store.pruneRuns({ retentionDays: 7, minKeepPerWorkflow: 5 });
    expect(deleted).toEqual([]);
  });

  it("keeps minKeepPerWorkflow newest and deletes the rest when all are old", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    const now = Date.now();
    for (let i = 0; i < 8; i++) {
      writeRun(runsDir, `run-old-${i}`, "builder", now - (10 + i) * DAY_MS);
    }
    const deleted = store.pruneRuns({ retentionDays: 7, minKeepPerWorkflow: 3 });
    expect(deleted).toHaveLength(5); // 8 - 3 = 5 deleted
  });

  it("never deletes the active run", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    const now = Date.now();
    const activeId = "run-old-active";
    writeRun(runsDir, activeId, "builder", now - 30 * DAY_MS);

    // Write state with active run
    writeFileSync(
      join(projectDir, ".kota", "workflow-state.json"),
      JSON.stringify({
        completedRuns: 1,
        pendingRuns: [],
        workflows: {},
        activeRuns: [{ runId: activeId, workflow: "builder", startedAt: new Date(now - 30 * DAY_MS).toISOString() }],
      }),
    );

    const deleted = store.pruneRuns({ retentionDays: 7, minKeepPerWorkflow: 0 });
    expect(deleted).not.toContain(activeId);
    expect(existsSync(join(runsDir, activeId))).toBe(true);
  });

  it("handles multiple workflows independently", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    const now = Date.now();
    // 2 old runs for builder, 2 old runs for explorer
    for (let i = 0; i < 2; i++) {
      writeRun(runsDir, `builder-old-${i}`, "builder", now - (10 + i) * DAY_MS);
      writeRun(runsDir, `explorer-old-${i}`, "explorer", now - (10 + i) * DAY_MS);
    }
    // minKeepPerWorkflow = 1 → keep 1 per workflow, delete 1 each
    const deleted = store.pruneRuns({ retentionDays: 7, minKeepPerWorkflow: 1 });
    expect(deleted).toHaveLength(2);
    // The newest of each workflow should be kept
    expect(existsSync(join(runsDir, "builder-old-0"))).toBe(true);
    expect(existsSync(join(runsDir, "explorer-old-0"))).toBe(true);
  });

  it("dry-run returns candidates without deleting", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      writeRun(runsDir, `run-old-${i}`, "builder", now - (10 + i) * DAY_MS);
    }
    const candidates = store.pruneRuns({
      retentionDays: 7,
      minKeepPerWorkflow: 0,
      dryRun: true,
    });
    expect(candidates).toHaveLength(3);
    // Nothing deleted
    for (let i = 0; i < 3; i++) {
      expect(existsSync(join(runsDir, `run-old-${i}`))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// WorkflowRunStore — tags
// ---------------------------------------------------------------------------

const minimalWorkflow: WorkflowDefinition = {
  name: "builder",
  description: "test",
  enabled: true,
  recoveryCapable: false,
  tags: [],
  definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
  moduleRoot: "/test-module-root",
  triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
  steps: [],
};

describe("WorkflowRunStore tags", () => {
  let projectDir: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-tags-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
    store = new WorkflowRunStore(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("persists tags from trigger payload in metadata.json", () => {
    const trigger = {
      event: "manual",
      schemaRef: null, payload: { triggeredAt: new Date().toISOString(), tags: ["release-v2", "debug"] },
    };
    const handle = store.createRun(minimalWorkflow, trigger);
    const meta = store.getRun(handle.metadata.id);
    expect(meta?.tags).toEqual(["release-v2", "debug"]);
  });

  it("omits tags field when trigger payload has no tags", () => {
    const trigger = { event: "manual", schemaRef: null, payload: { triggeredAt: new Date().toISOString() } };
    const handle = store.createRun(minimalWorkflow, trigger);
    const meta = store.getRun(handle.metadata.id);
    expect(meta?.tags).toBeUndefined();
  });

  it("listRuns with tag filter returns only matching runs", () => {
    const triggerA = {
      event: "manual",
      schemaRef: null, payload: { triggeredAt: new Date().toISOString(), tags: ["alpha"] },
    };
    const triggerB = {
      event: "manual",
      schemaRef: null, payload: { triggeredAt: new Date().toISOString(), tags: ["beta"] },
    };
    const triggerC = {
      event: "manual",
      schemaRef: null, payload: { triggeredAt: new Date().toISOString() },
    };
    store.createRun(minimalWorkflow, triggerA);
    store.createRun(minimalWorkflow, triggerB);
    store.createRun(minimalWorkflow, triggerC);

    const alphaRuns = store.listRuns({ tag: "alpha", limit: 10 });
    expect(alphaRuns).toHaveLength(1);
    expect(alphaRuns[0].tags).toEqual(["alpha"]);

    const betaRuns = store.listRuns({ tag: "beta", limit: 10 });
    expect(betaRuns).toHaveLength(1);
    expect(betaRuns[0].tags).toEqual(["beta"]);

    const allRuns = store.listRuns({ limit: 10 });
    expect(allRuns).toHaveLength(3);
  });

  it("projects durable run trigger, metadata, agent inputs, messages, and step artifacts", () => {
    const secret = "storage-secret-token";
    const trigger = {
      event: "manual",
      schemaRef: null,
      payload: {
        token: secret,
        email: "owner@example.test",
        triggeredAt: new Date().toISOString(),
      },
    };
    const handle = store.createRun(minimalWorkflow, trigger);
    const runDir = join(projectDir, handle.metadata.runDir);

    handle.writeAgentInputs(
      "agent",
      `system prompt ${secret}`,
      `user prompt ${secret}`,
    );
    handle.appendAgentMessage("agent", {
      type: "thinking",
      thinking: `private reasoning ${secret}`,
    });
    handle.appendAgentMessage("agent", {
      type: "tool_result",
      toolUseId: "tool-1",
      isError: false,
      content: `tool output ${secret}`,
    });
    handle.recordStep({
      id: "agent",
      type: "agent",
      status: "success",
      startedAt: new Date(1700000000000).toISOString(),
      completedAt: new Date(1700000001000).toISOString(),
      durationMs: 1000,
      output: { toolResult: `raw output ${secret}`, totalCostUsd: 0.01 },
    });
    handle.finish({
      status: "failed",
      durationMs: 1000,
      error: `terminal error ${secret}`,
    });

    const durableText = [
      readFileSync(join(runDir, "trigger.json"), "utf-8"),
      readFileSync(join(runDir, "metadata.json"), "utf-8"),
      readFileSync(join(runDir, "steps", "agent.input.md"), "utf-8"),
      readFileSync(join(runDir, "steps", "agent.events.jsonl"), "utf-8"),
      readFileSync(join(runDir, "steps", "agent.json"), "utf-8"),
      readFileSync(join(runDir, "error.txt"), "utf-8"),
    ].join("\n");

    expect(durableText).not.toContain(secret);
    expect(durableText).not.toContain("owner@example.test");
    expect(durableText).toContain('"redacted":true');
  });
});
