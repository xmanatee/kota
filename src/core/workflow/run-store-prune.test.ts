import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/usage.js";
import { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition } from "./types.js";

function makeScopeRoot(): string {
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
  status: "success" | "running" = "success",
): void {
  const runDir = join(runsDir, id);
  mkdirSync(runDir, { recursive: true });
  const metadata = {
    id,
    workflow,
    definitionPath: `src/modules/test/workflows/${workflow}/workflow.ts`,
    trigger: { event: "runtime.idle", schemaRef: null, payload: {} },
    startedAt: new Date(startedAtMs).toISOString(),
    status,
    ...(status === "success"
      ? {
          completedAt: new Date(startedAtMs + 1000).toISOString(),
          durationMs: 1000,
        }
      : {}),
    runDir: `.kota/runs/${id}`,
    steps: [],
  };
  writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata));
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("WorkflowRunStore.pruneRuns", () => {
  let workspaceRoot: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    workspaceRoot = makeScopeRoot();
    store = new WorkflowRunStore(workspaceRoot);
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("returns empty array when there are no runs", () => {
    const deleted = store.pruneRuns();
    expect(deleted).toEqual([]);
  });

  it("quarantines an invalid terminal timestamp without blocking retention", () => {
    const runsDir = join(workspaceRoot, ".kota", "runs");
    writeRun(
      runsDir,
      "run-invalid-timestamp",
      "builder",
      Date.now() - 30 * DAY_MS,
    );
    const metadataPath = join(
      runsDir,
      "run-invalid-timestamp",
      "metadata.json",
    );
    const metadata = JSON.parse(
      readFileSync(metadataPath, "utf-8"),
    ) as Record<string, unknown>;
    metadata.startedAt = "not-a-timestamp";
    writeFileSync(metadataPath, JSON.stringify(metadata));

    const terminalHistoryStore = new WorkflowRunStore(workspaceRoot, {
      authorityCriticalRunIds: () => new Set(),
    });
    expect(
      terminalHistoryStore.pruneRuns({
        retentionDays: 7,
        minKeepPerWorkflow: 0,
      }),
    ).toEqual([]);
    expect(existsSync(join(runsDir, "run-invalid-timestamp"))).toBe(true);
  });

  it("does not delete runs within the retention window", () => {
    const runsDir = join(workspaceRoot, ".kota", "runs");
    writeRun(runsDir, "run-recent", "builder", Date.now() - DAY_MS);
    const deleted = store.pruneRuns({ retentionDays: 7 });
    expect(deleted).toEqual([]);
    expect(existsSync(join(runsDir, "run-recent"))).toBe(true);
  });

  it("deletes runs older than retentionDays beyond minKeepPerWorkflow", () => {
    const runsDir = join(workspaceRoot, ".kota", "runs");
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
    const runsDir = join(workspaceRoot, ".kota", "runs");
    const now = Date.now();
    writeRun(runsDir, "run-recent", "builder", now - 6 * DAY_MS);
    writeRun(runsDir, "run-old", "builder", now - 8 * DAY_MS);

    const deleted = store.pruneRuns({ minKeepPerWorkflow: 0 });

    expect(deleted).toEqual(["run-old"]);
    expect(existsSync(join(runsDir, "run-recent"))).toBe(true);
    expect(existsSync(join(runsDir, "run-old"))).toBe(false);
  });

  it("respects minKeepPerWorkflow — keeps N newest even if older than retention", () => {
    const runsDir = join(workspaceRoot, ".kota", "runs");
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
    const runsDir = join(workspaceRoot, ".kota", "runs");
    const now = Date.now();
    for (let i = 0; i < 8; i++) {
      writeRun(runsDir, `run-old-${i}`, "builder", now - (10 + i) * DAY_MS);
    }
    const deleted = store.pruneRuns({ retentionDays: 7, minKeepPerWorkflow: 3 });
    expect(deleted).toHaveLength(5); // 8 - 3 = 5 deleted
  });

  it("never deletes active metadata even with an explicit retention override", () => {
    const runsDir = join(workspaceRoot, ".kota", "runs");
    const now = Date.now();
    const activeId = "run-old-active";
    writeRun(runsDir, activeId, "builder", now - 30 * DAY_MS, "running");

    const deleted = store.pruneRuns({
      retentionDays: 7,
      minKeepPerWorkflow: 0,
    });
    expect(deleted).not.toContain(activeId);
    expect(existsSync(join(runsDir, activeId))).toBe(true);
  });

  it("never deletes a durable-state protected run whose metadata is terminal", () => {
    const runsDir = join(workspaceRoot, ".kota", "runs");
    const protectedId = "run-old-integrating";
    writeRun(runsDir, protectedId, "builder", Date.now() - 30 * DAY_MS);

    const deleted = store.pruneRuns({
      retentionDays: 7,
      minKeepPerWorkflow: 0,
      protectedRunIds: new Set([protectedId]),
    });

    expect(deleted).not.toContain(protectedId);
    expect(existsSync(join(runsDir, protectedId))).toBe(true);
  });

  it("protects a queued run without requiring pre-execution metadata", () => {
    expect(
      store.pruneRuns({
        protectedRunIds: new Set(["queued-run"]),
      }),
    ).toEqual([]);
  });

  it("fails when durable authority identifies a run with no metadata directory", () => {
    expect(() =>
      store.pruneRuns({
        protectedRunIds: new Set(["waiting-run"]),
        authorityCriticalRunIds: new Set(["waiting-run"]),
      }),
    ).toThrow("metadata file is missing for an authority-critical workflow run");
  });

  it("handles multiple workflows independently", () => {
    const runsDir = join(workspaceRoot, ".kota", "runs");
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
    const runsDir = join(workspaceRoot, ".kota", "runs");
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

  it("does not delete old run directories that contain git-tracked evidence", () => {
    const runsDir = join(workspaceRoot, ".kota", "runs");
    const now = Date.now();
    writeRun(runsDir, "run-old-tracked", "builder", now - 30 * DAY_MS);
    writeRun(runsDir, "run-old-untracked", "builder", now - 31 * DAY_MS);
    writeFileSync(
      join(runsDir, "run-old-tracked", "evidence.txt"),
      "durable evidence\n",
    );

    execFileSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
    execFileSync(
      "git",
      ["add", ".kota/runs/run-old-tracked/evidence.txt"],
      { cwd: workspaceRoot, stdio: "ignore" },
    );

    const deleted = store.pruneRuns({ retentionDays: 7, minKeepPerWorkflow: 0 });

    expect(deleted).toEqual(["run-old-untracked"]);
    expect(existsSync(join(runsDir, "run-old-tracked"))).toBe(true);
    expect(existsSync(join(runsDir, "run-old-untracked"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WorkflowRunStore — durable metadata authority
// ---------------------------------------------------------------------------

describe("WorkflowRunStore durable metadata authority", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("ignores arbitrary child directories when no durable authority is available", () => {
    mkdirSync(join(workspaceRoot, ".kota", "runs", "fixture-report"), {
      recursive: true,
    });

    const store = new WorkflowRunStore(workspaceRoot);

    expect(store.listRuns()).toEqual([]);
  });

  it("fails list and direct lookup when durable state owns terminal-looking malformed evidence", () => {
    const runId = "run-integrating";
    const runsDir = join(workspaceRoot, ".kota", "runs");
    writeRun(runsDir, runId, "builder", Date.now());
    const metadataPath = join(runsDir, runId, "metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf-8")) as Record<string, unknown>;
    metadata.definitionPath = 17;
    writeFileSync(metadataPath, JSON.stringify(metadata));

    const store = new WorkflowRunStore(workspaceRoot, {
      authorityCriticalRunIds: () => new Set([runId]),
    });

    expect(() => store.listRuns({ limit: 10 })).toThrow(
      "Workflow run metadata authority is invalid",
    );
    expect(() => store.getRun(runId)).toThrow(
      "Workflow run metadata authority is invalid",
    );
  });

  it("reads finalized execution metadata while durable state is operational", () => {
    const runId = "run-operational-terminal-evidence";
    const runsDir = join(workspaceRoot, ".kota", "runs");
    writeRun(runsDir, runId, "builder", Date.now());
    const store = new WorkflowRunStore(workspaceRoot, {
      authorityCriticalRunIds: () => new Set([runId]),
      operationallyActiveRunIds: () => new Set([runId]),
    });

    expect(store.getRun(runId)?.status).toBe("success");
  });

  it.each(["running", "waiting", "integrating", "needs_attention"] as const)(
    "enumerates finalized execution metadata while durable state is %s",
    (state) => {
      const runId = `run-finalized-${state}`;
      const runsDir = join(workspaceRoot, ".kota", "runs");
      writeRun(runsDir, runId, "builder", Date.now());
      const stateDir = join(workspaceRoot, "operator-daemon-state");
      const database = new RunStateDatabase(stateDir);
      try {
        database.registerScope({
          id: "scope-a",
          rootPath: workspaceRoot,
          createdAt: "2026-09-02T00:00:00.000Z",
        });
        const { epoch } = database.beginDaemonSession(
          "2026-09-02T00:00:01.000Z",
        );
        database.admitRun({
          id: runId,
          scopeId: "scope-a",
          workflow: "builder",
          repository: "write",
          trigger: { event: "manual", schemaRef: null, payload: {} },
          resources: [],
          admittedAt: "2026-09-02T00:00:02.000Z",
        });
        database.startRun(runId, epoch, "2026-09-02T00:00:03.000Z");
        if (state === "integrating") {
          database.beginIntegration(runId, epoch, { phase: "publication" });
        } else if (state === "waiting" || state === "needs_attention") {
          database.suspendRun({
            runId,
            epoch,
            state: "waiting",
            suspendedAt: "2026-09-02T00:00:04.000Z",
            wait: { reason: "agent-backoff" },
          });
          if (state === "needs_attention") {
            database.requireRunAttention(runId, "operator review", []);
          }
        }

        const store = new WorkflowRunStore(workspaceRoot, { stateDir });
        expect(store.listRuns()).toEqual([
          expect.objectContaining({ id: runId, status: "success" }),
        ]);
      } finally {
        database.close();
      }
    },
  );

  it("fails enumeration when durable authority has no evidence directory", () => {
    const store = new WorkflowRunStore(workspaceRoot, {
      authorityCriticalRunIds: () => new Set(["run-waiting"]),
    });

    expect(() => store.listRuns()).toThrow(
      "metadata file is missing for an authority-critical workflow run",
    );
  });

  it("reads authority from an operator-configured daemon state root", () => {
    const runId = "run-integrating-external-state";
    const runsDir = join(workspaceRoot, ".kota", "runs");
    writeRun(runsDir, runId, "builder", Date.now());
    const metadataPath = join(runsDir, runId, "metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf-8")) as Record<
      string,
      unknown
    >;
    metadata.definitionPath = 17;
    writeFileSync(metadataPath, JSON.stringify(metadata));

    const stateDir = join(workspaceRoot, "operator-daemon-state");
    const database = new RunStateDatabase(stateDir);
    try {
      database.registerScope({
        id: "scope-a",
        rootPath: workspaceRoot,
        createdAt: "2026-09-02T00:00:00.000Z",
      });
      const { epoch } = database.beginDaemonSession("2026-09-02T00:00:01.000Z");
      database.admitRun({
        id: runId,
        scopeId: "scope-a",
        workflow: "builder",
        repository: "write",
        trigger: { event: "manual", schemaRef: null, payload: {} },
        resources: [],
        admittedAt: "2026-09-02T00:00:02.000Z",
      });
      database.startRun(runId, epoch, "2026-09-02T00:00:03.000Z");
      database.beginIntegration(runId, epoch, { phase: "publication" });

      const store = new WorkflowRunStore(workspaceRoot, { stateDir });
      expect(() => store.listRuns()).toThrow(
        "Workflow run metadata authority is invalid",
      );
    } finally {
      database.close();
    }
  });

  it("protects terminal metadata while its durable publication is undelivered", () => {
    const runId = "run-terminal-pending-publication";
    const runsDir = join(workspaceRoot, ".kota", "runs");
    writeRun(runsDir, runId, "builder", Date.now() - 30 * DAY_MS);

    const stateDir = join(workspaceRoot, "operator-daemon-state");
    const database = new RunStateDatabase(stateDir);
    try {
      database.registerScope({
        id: "scope-a",
        rootPath: workspaceRoot,
        createdAt: "2026-09-02T00:00:00.000Z",
      });
      const { epoch } = database.beginDaemonSession("2026-09-02T00:00:01.000Z");
      database.admitRun({
        id: runId,
        scopeId: "scope-a",
        workflow: "builder",
        repository: "write",
        trigger: { event: "manual", schemaRef: null, payload: {} },
        resources: [],
        admittedAt: "2026-09-02T00:00:02.000Z",
      });
      database.startRun(runId, epoch, "2026-09-02T00:00:03.000Z");
      database.finishRun(
        runId,
        epoch,
        "succeeded",
        "2026-09-02T00:00:04.000Z",
        undefined,
        {
          id: `workflow:${runId}:completed`,
          runId,
          scopeId: "scope-a",
          event: "workflow.completed",
          payload: { runId },
        },
      );

      const store = new WorkflowRunStore(workspaceRoot, { stateDir });
      expect(store.pruneRuns({ retentionDays: 7, minKeepPerWorkflow: 0 }))
        .not.toContain(runId);
      expect(existsSync(join(runsDir, runId))).toBe(true);
    } finally {
      database.close();
    }
  });

  it("quarantines durably terminal invalid JSON during startup pruning", () => {
    const runId = "run-terminal-invalid-json";
    const runsDir = join(workspaceRoot, ".kota", "runs");
    writeRun(runsDir, runId, "builder", Date.now() - 30 * DAY_MS);
    writeFileSync(join(runsDir, runId, "metadata.json"), "{invalid");

    const stateDir = join(workspaceRoot, "operator-daemon-state");
    const database = new RunStateDatabase(stateDir);
    const emitWarning = vi
      .spyOn(process, "emitWarning")
      .mockImplementation(() => {});
    try {
      database.registerScope({
        id: "scope-a",
        rootPath: workspaceRoot,
        createdAt: "2026-09-02T00:00:00.000Z",
      });
      const { epoch } = database.beginDaemonSession("2026-09-02T00:00:01.000Z");
      database.admitRun({
        id: runId,
        scopeId: "scope-a",
        workflow: "builder",
        repository: "write",
        trigger: { event: "manual", schemaRef: null, payload: {} },
        resources: [],
        admittedAt: "2026-09-02T00:00:02.000Z",
      });
      database.startRun(runId, epoch, "2026-09-02T00:00:03.000Z");
      database.finishRun(
        runId,
        epoch,
        "succeeded",
        "2026-09-02T00:00:04.000Z",
      );

      const store = new WorkflowRunStore(workspaceRoot, { stateDir });
      expect(store.pruneRuns({ retentionDays: 7, minKeepPerWorkflow: 0 }))
        .toEqual([]);
      expect(existsSync(join(runsDir, runId))).toBe(true);
      expect(emitWarning).toHaveBeenCalledWith(
        expect.stringContaining("Quarantined workflow run metadata"),
        { code: "KOTA_WORKFLOW_RUN_METADATA_QUARANTINED" },
      );
    } finally {
      emitWarning.mockRestore();
      database.close();
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
  repository: "read",
  tags: [],
  definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
  moduleRoot: "/test-module-root",
  triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
  steps: [],
};

describe("WorkflowRunStore tags", () => {
  let workspaceRoot: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-tags-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(workspaceRoot, ".kota", "runs"), { recursive: true });
    store = new WorkflowRunStore(workspaceRoot);
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
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

  it("lists valid runs when malformed history positively proves it is terminal", () => {
    const malformedDir = join(store.runsDir, "historical-fixture");
    mkdirSync(malformedDir, { recursive: true });
    writeFileSync(
      join(malformedDir, "metadata.json"),
      JSON.stringify({ id: "old", status: "success" }),
    );
    const handle = store.createRun(minimalWorkflow, {
      event: "manual",
      schemaRef: null,
      payload: { triggeredAt: new Date().toISOString() },
    });

    expect(store.listRuns({ limit: 10 }).map((run) => run.id)).toEqual([
      handle.metadata.id,
    ]);
    expect(() => store.getRun("historical-fixture")).toThrow();
  });

  it("scopes durable run trigger, metadata, agent inputs, messages, and step artifacts", () => {
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
    const runDir = join(workspaceRoot, handle.metadata.runDir);

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
      output: { toolResult: `raw output ${secret}` },
      usage: UNKNOWN_AGENT_USAGE,
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
