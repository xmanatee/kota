import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NO_ATTENTION_ITEMS_TEXT,
  renderOnDemandAttention,
  runAttentionDigestStep,
} from "./step.js";

function makeTaskDir(projectDir: string, state: string, count: number): void {
  const dir = join(projectDir, "data", "tasks", state);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, `task-test-${i}.md`), `# task ${i}\n`, "utf-8");
  }
}

function writeBlockedTask(
  projectDir: string,
  id: string,
  opts: { daysAgo: number; ownerBlocker?: boolean; body?: string },
): void {
  const dir = join(projectDir, "data", "tasks", "blocked");
  mkdirSync(dir, { recursive: true });
  const updatedAt = new Date(Date.now() - opts.daysAgo * 24 * 60 * 60 * 1000)
    .toISOString();
  const ownerSection = opts.ownerBlocker
    ? "## Blocker\n\nWaiting on owner decision between options A and B.\n"
    : "";
  const extraBody = opts.body ?? "";
  const content = `---\nid: ${id}\ntitle: ${id}\nstatus: blocked\npriority: p2\narea: autonomy\nsummary: test\ncreated_at: ${updatedAt}\nupdated_at: ${updatedAt}\n---\n\n## Problem\n\nTest.\n\n${ownerSection}${extraBody}`;
  writeFileSync(join(dir, `${id}.md`), content, "utf-8");
}

function writeRunMetadata(
  runsDir: string,
  id: string,
  workflow: string,
  status: string,
  totalCostUsd = 0,
  warnings?: Array<{ type: string; message: string }>,
): void {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      id,
      workflow,
      definitionPath: `src/modules/autonomy/workflows/${workflow}/workflow.ts`,
      trigger: { event: "runtime.idle", payload: {} },
      startedAt: now,
      completedAt: now,
      status,
      durationMs: 1000,
      runDir: `.kota/runs/${id}`,
      steps: [],
      totalCostUsd,
      ...(warnings ? { warnings } : {}),
    }),
    "utf-8",
  );
}

describe("runAttentionDigestStep", () => {
  let projectDir: string;
  let runsDir: string;
  let emittedEvents: Array<{ event: string; payload: Record<string, unknown> }>;
  let emit: (event: string, payload: Record<string, unknown>) => void;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-digest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
    emittedEvents = [];
    emit = (event, payload) => emittedEvents.push({ event, payload });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function runSteps(n: number): void {
    for (let i = 0; i < n; i++) {
      runAttentionDigestStep(projectDir, runsDir, undefined, emit);
    }
  }

  it("does not emit before 10 invocations", () => {
    runSteps(9);
    expect(emittedEvents).toHaveLength(0);
  });

  it("does not emit at 10 invocations when nothing warrants attention", () => {
    makeTaskDir(projectDir, "ready", 1);
    makeTaskDir(projectDir, "backlog", 1);
    runSteps(10);
    expect(emittedEvents).toHaveLength(0);
  });

  it("emits workflow.attention.digest at exactly 10 invocations when builder failure streak >= 3", () => {
    writeRunMetadata(runsDir, "2026-03-27-run-c", "builder", "failed");
    writeRunMetadata(runsDir, "2026-03-27-run-b", "builder", "failed");
    writeRunMetadata(runsDir, "2026-03-27-run-a", "builder", "failed");

    runSteps(10);
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].event).toBe("workflow.attention.digest");
    const text = emittedEvents[0].payload.text as string;
    expect(text).toContain("Builder failure streak");
    expect(text).toContain("consecutive failures");
  });

  it("does not emit at 10 invocations when builder failures < 3", () => {
    makeTaskDir(projectDir, "ready", 1);
    makeTaskDir(projectDir, "backlog", 1);
    writeRunMetadata(runsDir, "2026-03-27-run-b", "builder", "failed");
    writeRunMetadata(runsDir, "2026-03-27-run-a", "builder", "failed");

    runSteps(10);
    expect(emittedEvents).toHaveLength(0);
  });

  it("emits digest for stalled work when doing count >= 2", () => {
    makeTaskDir(projectDir, "doing", 2);

    runSteps(10);
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].event).toBe("workflow.attention.digest");
    const text = emittedEvents[0].payload.text as string;
    expect(text).toContain("Stalled work");
    expect(text).toContain("2 tasks stuck in doing");
  });

  it("emits digest for blocked backlog when blocked count >= 2", () => {
    makeTaskDir(projectDir, "blocked", 2);

    runSteps(10);
    expect(emittedEvents).toHaveLength(1);
    const text = emittedEvents[0].payload.text as string;
    expect(text).toContain("Blocked backlog");
    expect(text).toContain("2 blocked tasks");
  });

  it("emits digest when ready queue is empty", () => {
    makeTaskDir(projectDir, "backlog", 1);
    runSteps(10);
    expect(emittedEvents).toHaveLength(1);
    const text = emittedEvents[0].payload.text as string;
    expect(text).toContain("Empty ready queue");
    expect(text).toContain("Builder has nothing to pull");
  });

  it("emits digest when backlog is empty", () => {
    makeTaskDir(projectDir, "ready", 1);
    runSteps(10);
    expect(emittedEvents).toHaveLength(1);
    const text = emittedEvents[0].payload.text as string;
    expect(text).toContain("Empty backlog");
    expect(text).toContain("No reserves for explorer to promote");
  });

  it("does not emit when ready and backlog are populated and nothing else warrants attention", () => {
    makeTaskDir(projectDir, "ready", 2);
    makeTaskDir(projectDir, "backlog", 1);
    runSteps(10);
    expect(emittedEvents).toHaveLength(0);
  });

  it("includes multiple attention items in one digest", () => {
    makeTaskDir(projectDir, "doing", 3);
    makeTaskDir(projectDir, "blocked", 2);
    makeTaskDir(projectDir, "ready", 1);
    makeTaskDir(projectDir, "backlog", 1);

    runSteps(10);
    expect(emittedEvents).toHaveLength(1);
    const text = emittedEvents[0].payload.text as string;
    expect(text).toContain("Stalled work");
    expect(text).toContain("Blocked backlog");
    expect(text).toContain("2 items");
  });

  it("emits digest every 10 invocations, not just once", () => {
    makeTaskDir(projectDir, "doing", 2);

    runSteps(20);
    expect(emittedEvents).toHaveLength(2);
  });

  it("digest text starts with attention digest header", () => {
    makeTaskDir(projectDir, "doing", 2);
    runSteps(10);
    const text = emittedEvents[0].payload.text as string;
    expect(text).toMatch(/^Attention digest \(\d+ items?\):/);
  });

  it("emits digest without emit callback (no-op, no throw)", () => {
    makeTaskDir(projectDir, "doing", 2);
    // runSteps without emit — should not throw
    for (let i = 0; i < 10; i++) {
      runAttentionDigestStep(projectDir, runsDir);
    }
    expect(emittedEvents).toHaveLength(0); // our callback was never attached
  });

  it("lists all run dirs to verify test isolation", () => {
    const entries = readdirSync(runsDir);
    expect(entries).toHaveLength(0);
  });

  describe("warnings frequency check", () => {
    beforeEach(() => {
      delete process.env.KOTA_DIGEST_WARNINGS_COUNT;
      delete process.env.KOTA_DIGEST_WARNINGS_WINDOW;
      delete process.env.KOTA_DIGEST_BLOCKED_AGE_DAYS;
    });

    afterEach(() => {
      delete process.env.KOTA_DIGEST_WARNINGS_COUNT;
      delete process.env.KOTA_DIGEST_WARNINGS_WINDOW;
      delete process.env.KOTA_DIGEST_BLOCKED_AGE_DAYS;
    });

    it("emits digest when N builder runs have completed-with-warnings (default N=3, M=10)", () => {
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      for (let i = 0; i < 3; i++) {
        writeRunMetadata(runsDir, `2026-04-01-warn-${i}`, "builder", "completed-with-warnings");
      }
      runSteps(10);
      expect(emittedEvents).toHaveLength(1);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Repeated warnings");
      expect(text).toContain("3 of the last 3 builder runs completed with warnings");
    });

    it("does not emit when fewer than N builder runs have warnings", () => {
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      for (let i = 0; i < 2; i++) {
        writeRunMetadata(runsDir, `2026-04-01-warn-${i}`, "builder", "completed-with-warnings");
      }
      runSteps(10);
      expect(emittedEvents).toHaveLength(0);
    });

    it("respects custom N and M env vars", () => {
      process.env.KOTA_DIGEST_WARNINGS_COUNT = "2";
      process.env.KOTA_DIGEST_WARNINGS_WINDOW = "5";
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      for (let i = 0; i < 2; i++) {
        writeRunMetadata(runsDir, `2026-04-01-warn-${i}`, "builder", "completed-with-warnings");
      }
      runSteps(10);
      expect(emittedEvents).toHaveLength(1);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Repeated warnings");
    });

    it("includes warning type in detail when all warnings share the same type", () => {
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      const warnings = [{ type: "maxStepOutputBytes", message: "output truncated" }];
      for (let i = 0; i < 3; i++) {
        writeRunMetadata(runsDir, `2026-04-01-warn-${i}`, "builder", "completed-with-warnings", 0, warnings);
      }
      runSteps(10);
      expect(emittedEvents).toHaveLength(1);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("maxStepOutputBytes");
    });

    it("does not include type in detail when warnings have mixed types", () => {
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      writeRunMetadata(runsDir, "2026-04-01-warn-0", "builder", "completed-with-warnings", 0, [{ type: "typeA", message: "a" }]);
      writeRunMetadata(runsDir, "2026-04-01-warn-1", "builder", "completed-with-warnings", 0, [{ type: "typeB", message: "b" }]);
      writeRunMetadata(runsDir, "2026-04-01-warn-2", "builder", "completed-with-warnings", 0, [{ type: "typeA", message: "a2" }]);
      runSteps(10);
      expect(emittedEvents).toHaveLength(1);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Repeated warnings");
      expect(text).not.toContain("typeA");
      expect(text).not.toContain("typeB");
    });

    it("does not count non-builder warning runs", () => {
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      for (let i = 0; i < 5; i++) {
        writeRunMetadata(runsDir, `2026-04-01-warn-${i}`, "explorer", "completed-with-warnings");
      }
      runSteps(10);
      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe("long-blocked task surfacing", () => {
    beforeEach(() => {
      delete process.env.KOTA_DIGEST_BLOCKED_AGE_DAYS;
    });

    afterEach(() => {
      delete process.env.KOTA_DIGEST_BLOCKED_AGE_DAYS;
    });

    it("does not surface a task that has not reached the threshold", () => {
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      // Just under 3 days (default threshold) — floor(ageDays) = 2
      writeBlockedTask(projectDir, "task-fresh-a", { daysAgo: 2.9 });
      writeBlockedTask(projectDir, "task-fresh-b", { daysAgo: 1 });
      runSteps(10);
      expect(emittedEvents).toHaveLength(1);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Blocked backlog");
      expect(text).not.toContain("Stale blocker");
      expect(text).not.toContain("Owner decision pending");
    });

    it("surfaces a task sitting exactly at the threshold", () => {
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      // daysAgo=3 with default threshold=3 → floor(ageDays)=3 ≥ 3
      writeBlockedTask(projectDir, "task-threshold", { daysAgo: 3 });
      writeBlockedTask(projectDir, "task-fresh", { daysAgo: 1 });
      runSteps(10);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Stale blocker");
      expect(text).toContain("task-threshold");
      expect(text).toContain("blocked 3d");
      expect(text).toContain("Blocked backlog");
    });

    it("surfaces a task one day past the threshold", () => {
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      writeBlockedTask(projectDir, "task-stale-a", { daysAgo: 4 });
      writeBlockedTask(projectDir, "task-fresh-b", { daysAgo: 1 });
      runSteps(10);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Stale blocker");
      expect(text).toContain("task-stale-a");
      expect(text).toContain("blocked 4d");
      expect(text).toContain("Blocked backlog");
    });

    it("labels an owner-blocker task differently from a stale blocker", () => {
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      writeBlockedTask(projectDir, "task-owner", {
        daysAgo: 5,
        ownerBlocker: true,
      });
      writeBlockedTask(projectDir, "task-stale", { daysAgo: 4 });
      runSteps(10);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Owner decision pending");
      expect(text).toContain("task-owner");
      expect(text).toContain("Stale blocker");
      expect(text).toContain("task-stale");
    });

    it("suppresses the aggregate line when every blocked task is long-blocked", () => {
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      writeBlockedTask(projectDir, "task-old-a", { daysAgo: 10 });
      writeBlockedTask(projectDir, "task-old-b", { daysAgo: 5 });
      runSteps(10);
      const text = emittedEvents[0].payload.text as string;
      expect(text).not.toContain("Blocked backlog");
      expect(text).toContain("task-old-a");
      expect(text).toContain("task-old-b");
    });

    it("caps individual items at five and summarizes the tail", () => {
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      for (let i = 0; i < 7; i++) {
        writeBlockedTask(projectDir, `task-old-${i}`, { daysAgo: 10 + i });
      }
      runSteps(10);
      const text = emittedEvents[0].payload.text as string;
      // Oldest five surface — task-old-6 (16d) down to task-old-2 (12d)
      expect(text).toContain("task-old-6");
      expect(text).toContain("task-old-2");
      // Younger two collapsed into the tail summary
      expect(text).not.toContain("task-old-1");
      expect(text).not.toContain("task-old-0");
      expect(text).toContain("More long-blocked tasks");
      expect(text).toContain("2 additional blocked tasks past threshold");
    });

    it("respects KOTA_DIGEST_BLOCKED_AGE_DAYS override", () => {
      process.env.KOTA_DIGEST_BLOCKED_AGE_DAYS = "1";
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      writeBlockedTask(projectDir, "task-day-old", { daysAgo: 1 });
      runSteps(10);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Stale blocker");
      expect(text).toContain("task-day-old");
    });
  });

  describe("renderOnDemandAttention", () => {
    it("returns the same body cadence would emit when items exist", () => {
      makeTaskDir(projectDir, "doing", 2);
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);

      // Drive the cadence so we can compare its emitted text against the
      // on-demand body for the exact same repo state.
      runSteps(10);
      expect(emittedEvents).toHaveLength(1);
      const cadenceText = emittedEvents[0].payload.text as string;

      const result = renderOnDemandAttention({ projectDir, runsDir });
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.text).toBe(cadenceText);
    });

    it("returns the short fixed reply when nothing warrants attention", () => {
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);

      const result = renderOnDemandAttention({ projectDir, runsDir });
      expect(result.items).toEqual([]);
      expect(result.text).toBe(NO_ATTENTION_ITEMS_TEXT);
    });

    it("does not write the cadence counter file", () => {
      makeTaskDir(projectDir, "doing", 2);
      const counterFile = join(runsDir, "..", "attention-digest-counter.json");
      expect(existsSync(counterFile)).toBe(false);

      renderOnDemandAttention({ projectDir, runsDir });

      expect(existsSync(counterFile)).toBe(false);
    });

    it("does not advance an existing cadence counter", () => {
      const counterFile = join(runsDir, "..", "attention-digest-counter.json");
      writeFileSync(counterFile, JSON.stringify({ count: 7 }), "utf-8");
      makeTaskDir(projectDir, "doing", 2);

      renderOnDemandAttention({ projectDir, runsDir });

      const persisted = JSON.parse(readFileSync(counterFile, "utf-8"));
      expect(persisted.count).toBe(7);
    });

    it("does not emit workflow.attention.digest", () => {
      makeTaskDir(projectDir, "doing", 2);
      // Even though detection finds an item, the on-demand path must not emit.
      renderOnDemandAttention({ projectDir, runsDir });
      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe("operator-gated precondition aging", () => {
    afterEach(() => {
      delete process.env.KOTA_DIGEST_BLOCKED_AGE_DAYS;
      delete process.env.KOTA_DIGEST_BLOCKED_AGED_DAYS;
    });

    it("surfaces an aged owner-decision precondition past 14 days", () => {
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      writeBlockedTask(projectDir, "task-aged-owner", {
        daysAgo: 20,
        body: [
          "## Unblock Precondition",
          "",
          "```",
          "kind: owner-decision",
          "slot: pick-variant",
          "question: Which variant?",
          "context: ctx.",
          "```",
          "",
        ].join("\n"),
      });
      runSteps(10);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Operator-gated blocker aged");
      expect(text).toContain("task-aged-owner");
      expect(text).toContain("operator-gated precondition");
    });

    it("does not surface an operator-capture precondition under the threshold", () => {
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      writeBlockedTask(projectDir, "task-fresh-capture", {
        daysAgo: 5,
        body: [
          "## Unblock Precondition",
          "",
          "```",
          "kind: operator-capture",
          "path: .kota/runs/foo",
          "description: x",
          "```",
          "",
        ].join("\n"),
      });
      runSteps(10);
      const text = emittedEvents[0].payload.text as string;
      expect(text).not.toContain("Operator-gated blocker aged");
    });

    it("does not surface an aged task-done precondition (autonomy can promote it)", () => {
      makeTaskDir(projectDir, "ready", 1);
      makeTaskDir(projectDir, "backlog", 1);
      writeBlockedTask(projectDir, "task-aged-task-done", {
        daysAgo: 30,
        body: [
          "## Unblock Precondition",
          "",
          "```",
          "kind: task-done",
          "ref: task-enabler",
          "```",
          "",
        ].join("\n"),
      });
      runSteps(10);
      const text = emittedEvents[0].payload.text as string;
      // task-done preconditions can auto-promote, so they only show under the
      // shorter "long-blocked" threshold, not the operator-gated escalation.
      expect(text).not.toContain("Operator-gated blocker aged");
    });
  });

});
