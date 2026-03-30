import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAttentionDigestStep } from "./attention-digest.js";

function makeTaskDir(projectDir: string, state: string, count: number): void {
  const dir = join(projectDir, "tasks", state);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, `task-test-${i}.md`), `# task ${i}\n`, "utf-8");
  }
}

function writeRunMetadata(
  runsDir: string,
  id: string,
  workflow: string,
  status: string,
  totalCostUsd = 0,
): void {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      id,
      workflow,
      definitionPath: `src/workflows/${workflow}/workflow.ts`,
      trigger: { event: "runtime.idle", payload: {} },
      startedAt: now,
      completedAt: now,
      status,
      durationMs: 1000,
      runDir: `.kota/runs/${id}`,
      steps: [],
      totalCostUsd,
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
    delete process.env.KOTA_DIGEST_COST_THRESHOLD;
    delete process.env.KOTA_COST_HARD_LIMIT_USD;
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    delete process.env.KOTA_DIGEST_COST_THRESHOLD;
    delete process.env.KOTA_COST_HARD_LIMIT_USD;
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

  it("emits digest for high spend when total exceeds threshold", () => {
    process.env.KOTA_DIGEST_COST_THRESHOLD = "5";
    writeRunMetadata(runsDir, "2026-03-27-run-a", "builder", "success", 10);

    runSteps(10);
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].event).toBe("workflow.attention.digest");
    const text = emittedEvents[0].payload.text as string;
    expect(text).toContain("Budget pressure");
    expect(text).toContain("$10.00");
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

  describe("cost circuit breaker", () => {
    const pausePath = () => join(projectDir, ".kota", "dispatch-paused");

    it("does not write pause file when spend is below hard limit", () => {
      process.env.KOTA_COST_HARD_LIMIT_USD = "50";
      writeRunMetadata(runsDir, "2026-03-27-run-a", "builder", "success", 10);
      runSteps(10);
      expect(existsSync(pausePath())).toBe(false);
    });

    it("does not write pause file when soft threshold exceeded but hard limit is not", () => {
      process.env.KOTA_DIGEST_COST_THRESHOLD = "5";
      process.env.KOTA_COST_HARD_LIMIT_USD = "50";
      writeRunMetadata(runsDir, "2026-03-27-run-a", "builder", "success", 10);
      runSteps(10);
      expect(existsSync(pausePath())).toBe(false);
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].event).toBe("workflow.attention.digest");
      expect(emittedEvents[0].payload.text as string).toContain("Budget pressure");
    });

    it("writes pause file and emits cost.limit.reached when hard limit is exceeded", () => {
      process.env.KOTA_COST_HARD_LIMIT_USD = "5";
      writeRunMetadata(runsDir, "2026-03-27-run-a", "builder", "success", 10);
      runSteps(10);
      expect(existsSync(pausePath())).toBe(true);
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].event).toBe("workflow.cost.limit.reached");
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("circuit breaker tripped");
      expect(text).toContain("$10.00");
      expect(text).toContain("dispatch-paused");
    });

    it("writes pause file even when no emit callback is provided", () => {
      process.env.KOTA_COST_HARD_LIMIT_USD = "5";
      writeRunMetadata(runsDir, "2026-03-27-run-a", "builder", "success", 10);
      for (let i = 0; i < 10; i++) {
        runAttentionDigestStep(projectDir, runsDir);
      }
      expect(existsSync(pausePath())).toBe(true);
    });

    it("does not emit regular digest when hard limit is exceeded", () => {
      process.env.KOTA_COST_HARD_LIMIT_USD = "5";
      writeRunMetadata(runsDir, "2026-03-27-run-a", "builder", "success", 10);
      makeTaskDir(projectDir, "doing", 3);
      runSteps(10);
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].event).toBe("workflow.cost.limit.reached");
    });
  });
});
