import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { initEventBus, resetEventBus } from "#core/events/event-bus.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { digestStateFromCounts, type QueueCounts } from "./aggregate.js";
import {
  DAILY_DIGEST_STATE_KEY,
  renderOnDemandDigest,
} from "./on-demand.js";

vi.mock("#core/daemon/owner-question-queue.js", async () => {
  const actual =
    await vi.importActual<
      typeof import("#core/daemon/owner-question-queue.js")
    >("#core/daemon/owner-question-queue.js");
  let queue: InstanceType<typeof actual.OwnerQuestionQueue> | null = null;
  return {
    ...actual,
    getOwnerQuestionQueue: (dir?: string) => {
      if (!queue) {
        queue = new actual.OwnerQuestionQueue(
          dir ?? join(process.cwd(), ".kota", "owner-questions"),
        );
      }
      return queue;
    },
    resetOwnerQuestionQueue: () => {
      queue = null;
    },
  };
});

describe("renderOnDemandDigest", () => {
  let workspaceRoot: string;
  const observed: Array<{ event: string; payload: unknown }> = [];
  let unsubscribe: () => void;

  beforeEach(async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "daily-digest-on-demand-"));
    mkdirSync(join(workspaceRoot, ".kota", "runs"), { recursive: true });
    mkdirSync(join(workspaceRoot, "data", "tasks", "ready"), { recursive: true });
    mkdirSync(join(workspaceRoot, "data", "tasks", "blocked"), { recursive: true });
    observed.length = 0;
    const bus = initEventBus();
    const handler = (payload: unknown) => {
      observed.push({ event: "workflow.daily.digest", payload });
    };
    unsubscribe = bus.on("workflow.daily.digest", handler as never);
    const ownerMod = await import("#core/daemon/owner-question-queue.js");
    ownerMod.resetOwnerQuestionQueue();
    ownerMod.getOwnerQuestionQueue(join(workspaceRoot, ".kota", "owner-questions"));
  });

  afterEach(() => {
    unsubscribe?.();
    resetEventBus();
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function persistCadenceState(counts: QueueCounts): void {
    const stateDir = join(workspaceRoot, ".kota");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const store = new RunStateDatabase(stateDir);
    try {
      store.registerScope({
        id: scopeId,
        rootPath: workspaceRoot,
        createdAt: "2026-04-25T07:59:00.000Z",
      });
      const { epoch } = store.beginDaemonSession("2026-04-25T07:59:00.000Z");
      store.admitRun({
        id: "daily-digest-state-fixture",
        scopeId,
        workflow: "daily-digest",
        repository: "read",
        trigger: { event: "schedule", schemaRef: null, payload: {} },
        resources: [],
        admittedAt: "2026-04-25T07:59:01.000Z",
      });
      store.startRun(
        "daily-digest-state-fixture",
        epoch,
        "2026-04-25T07:59:02.000Z",
      );
      store.stageScopeStateMutation({
        runId: "daily-digest-state-fixture",
        key: DAILY_DIGEST_STATE_KEY,
        expectedRevision: 0,
        value: digestStateFromCounts(counts, Date.parse("2026-04-25T08:00:00.000Z")),
        stagedAt: "2026-04-25T07:59:03.000Z",
      });
      store.finishRun(
        "daily-digest-state-fixture",
        epoch,
        "succeeded",
        "2026-04-25T08:00:00.000Z",
      );
    } finally {
      store.close();
    }
  }

  it("returns the rendered digest body without creating cadence state", () => {
    const databasePath = join(workspaceRoot, ".kota", "kota.sqlite");
    expect(existsSync(databasePath)).toBe(false);

    const result = renderOnDemandDigest({
      scopeRoot: workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
    });

    expect(result.text).toContain("Daily digest");
    expect(result.data.quiet).toBe(true);
    expect(existsSync(databasePath)).toBe(false);
  });

  it("does not emit workflow.daily.digest", () => {
    renderOnDemandDigest({ scopeRoot: workspaceRoot, stateDir: join(workspaceRoot, ".kota") });
    expect(observed).toEqual([]);
  });

  it("uses the persisted cadence snapshot for the queue delta baseline", () => {
    persistCadenceState({ backlog: 0, ready: 0, doing: 0, blocked: 2 });
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "ready", "task-x.md"),
      "---\nid: task-x\n---\n",
    );

    const result = renderOnDemandDigest({
      scopeRoot: workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
    });
    expect(result.data.queueDelta.previous).toEqual({
      backlog: 0,
      ready: 0,
      doing: 0,
      blocked: 2,
    });
    expect(result.data.queueDelta.delta.ready).toBe(1);
  });

  it("reads pending owner questions from the requested scope directory", async () => {
    const ownerMod = await import("#core/daemon/owner-question-queue.js");
    ownerMod.resetOwnerQuestionQueue();
    const defaultQueue = ownerMod.getOwnerQuestionQueue(
      join(workspaceRoot, "default-project", ".kota", "owner-questions"),
    );
    defaultQueue.enqueue({
      context: "ctx",
      question: "default project question?",
      reason: "r",
      source: "test",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "test" },
    });

    const projectQueue = new ownerMod.OwnerQuestionQueue(
      join(workspaceRoot, ".kota", "owner-questions"),
    );
    projectQueue.enqueue({
      context: "ctx",
      question: "requested project question?",
      reason: "r",
      source: "test",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "test" },
    });

    const result = renderOnDemandDigest({
      scopeRoot: workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
      windowEndMs: Date.parse("2026-04-26T08:00:00.000Z"),
    });

    expect(result.data.pendingOwnerQuestions.map((q) => q.question)).toEqual([
      "requested project question?",
    ]);
    expect(result.text).toContain("requested project question?");
    expect(result.text).not.toContain("default project question?");
  });
});
