import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { initEventBus, resetEventBus } from "#core/events/event-bus.js";
import { initProviderRegistry, resetProviderRegistry } from "#core/modules/provider-registry.js";
import type { DurableEffectValue } from "#core/workflow/run-context.js";
import { RUN_STATE_READER_PROVIDER_TYPE } from "#core/workflow/run-state-reader-provider.js";
import { digestStateFromCounts, type QueueCounts } from "./aggregate.js";
import { renderOnDemandDigest } from "./on-demand.js";

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
  let projectDir: string;
  const observed: Array<{ event: string; payload: unknown }> = [];
  let unsubscribe: () => void;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "daily-digest-on-demand-"));
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "ready"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "blocked"), { recursive: true });
    observed.length = 0;
    const bus = initEventBus();
    const handler = (payload: unknown) => {
      observed.push({ event: "workflow.daily.digest", payload });
    };
    unsubscribe = bus.on("workflow.daily.digest", handler as never);
    const ownerMod = await import("#core/daemon/owner-question-queue.js");
    ownerMod.resetOwnerQuestionQueue();
    ownerMod.getOwnerQuestionQueue(join(projectDir, ".kota", "owner-questions"));
  });

  afterEach(() => {
    unsubscribe?.();
    resetEventBus();
    resetProviderRegistry();
    rmSync(projectDir, { recursive: true, force: true });
  });

  function persistCadenceState(counts: QueueCounts): void {
    const projectId = deriveDirectoryScopeId(projectDir);
    const value = digestStateFromCounts(
      counts,
      Date.parse("2026-04-25T08:00:00.000Z"),
    );
    initProviderRegistry().register(RUN_STATE_READER_PROVIDER_TYPE, "test", {
      getProjectIdByRootPath: (rootPath) => rootPath === projectDir ? projectId : null,
      readProjectStateValue: <T extends DurableEffectValue>() => ({
        revision: 1,
        value: value as unknown as T,
      }),
    });
  }

  it("returns the rendered digest body without creating cadence state", () => {
    const databasePath = join(projectDir, ".kota", "kota.sqlite");
    expect(existsSync(databasePath)).toBe(false);

    const result = renderOnDemandDigest({
      projectDir,
      stateDir: join(projectDir, ".kota"),
    });

    expect(result.text).toContain("Daily digest");
    expect(result.data.quiet).toBe(true);
    expect(existsSync(databasePath)).toBe(false);
  });

  it("does not emit workflow.daily.digest", () => {
    renderOnDemandDigest({ projectDir, stateDir: join(projectDir, ".kota") });
    expect(observed).toEqual([]);
  });

  it("uses the persisted cadence snapshot for the queue delta baseline", () => {
    persistCadenceState({ backlog: 0, ready: 0, doing: 0, blocked: 2 });
    writeFileSync(
      join(projectDir, "data", "tasks", "ready", "task-x.md"),
      "---\nid: task-x\n---\n",
    );

    const result = renderOnDemandDigest({
      projectDir,
      stateDir: join(projectDir, ".kota"),
    });
    expect(result.data.queueDelta.previous).toEqual({
      backlog: 0,
      ready: 0,
      doing: 0,
      blocked: 2,
    });
    expect(result.data.queueDelta.delta.ready).toBe(1);
  });

  it("reads pending owner questions from the requested project directory", async () => {
    const ownerMod = await import("#core/daemon/owner-question-queue.js");
    ownerMod.resetOwnerQuestionQueue();
    const defaultQueue = ownerMod.getOwnerQuestionQueue(
      join(projectDir, "default-project", ".kota", "owner-questions"),
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
      join(projectDir, ".kota", "owner-questions"),
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
      projectDir,
      stateDir: join(projectDir, ".kota"),
      windowEndMs: Date.parse("2026-04-26T08:00:00.000Z"),
    });

    expect(result.data.pendingOwnerQuestions.map((q) => q.question)).toEqual([
      "requested project question?",
    ]);
    expect(result.text).toContain("requested project question?");
    expect(result.text).not.toContain("default project question?");
  });
});
