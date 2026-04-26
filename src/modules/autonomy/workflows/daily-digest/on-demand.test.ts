import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initEventBus, resetEventBus } from "#core/events/event-bus.js";
import {
  DAILY_DIGEST_STATE_FILENAME,
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
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns the rendered digest body and underlying data without writing the cadence snapshot", () => {
    const statePath = join(projectDir, ".kota", DAILY_DIGEST_STATE_FILENAME);
    expect(existsSync(statePath)).toBe(false);

    const result = renderOnDemandDigest({ projectDir });

    expect(result.text).toContain("Daily digest");
    expect(result.data.quiet).toBe(true);
    expect(existsSync(statePath)).toBe(false);
  });

  it("does not modify a pre-existing snapshot file", () => {
    const statePath = join(projectDir, ".kota", DAILY_DIGEST_STATE_FILENAME);
    const baseline = JSON.stringify({
      capturedAt: "2026-04-25T08:00:00.000Z",
      counts: { backlog: 7, ready: 1, doing: 0, blocked: 4 },
    });
    writeFileSync(statePath, baseline, "utf-8");

    renderOnDemandDigest({ projectDir });

    expect(readFileSync(statePath, "utf-8")).toBe(baseline);
  });

  it("does not emit workflow.daily.digest", () => {
    renderOnDemandDigest({ projectDir });
    expect(observed).toEqual([]);
  });

  it("uses the persisted cadence snapshot for the queue delta baseline", () => {
    const statePath = join(projectDir, ".kota", DAILY_DIGEST_STATE_FILENAME);
    writeFileSync(
      statePath,
      JSON.stringify({
        capturedAt: "2026-04-25T08:00:00.000Z",
        counts: { backlog: 0, ready: 0, doing: 0, blocked: 2 },
      }),
      "utf-8",
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "ready", "task-x.md"),
      "---\nid: task-x\n---\n",
    );

    const result = renderOnDemandDigest({ projectDir });
    expect(result.data.queueDelta.previous).toEqual({
      backlog: 0,
      ready: 0,
      doing: 0,
      blocked: 2,
    });
    expect(result.data.queueDelta.delta.ready).toBe(1);
  });
});
