import {
  mkdirSync,
  realpathSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import {
  inspectAttentionDigestStep,
  NO_ATTENTION_ITEMS_TEXT,
  renderOnDemandAttention,
} from "./step.js";

function makeTaskDir(workspaceRoot: string, state: string, count: number): void {
  const dir = state === "done" || state === "dropped"
    ? join(workspaceRoot, "data", "tasks", "archive")
    : join(workspaceRoot, "data", "tasks");
  mkdirSync(dir, { recursive: true });
  const offset = readdirSync(dir).filter((name) => name.startsWith(`task-${state}-`)).length;
  for (let i = 0; i < count; i++) {
    const id = `task-${state}-${offset + i}`;
    writeFileSync(
      join(dir, `${id}.md`),
      `---\nstatus: ${state}\npriority: p2\n---\n\n# ${id}\n`,
      "utf-8",
    );
  }
}

function writeBlockedTask(
  workspaceRoot: string,
  id: string,
  opts: { daysAgo: number; ownerBlocker?: boolean; body?: string },
): void {
  const dir = join(workspaceRoot, "data", "tasks");
  mkdirSync(dir, { recursive: true });
  const updatedAt = new Date(Date.now() - opts.daysAgo * 24 * 60 * 60 * 1000)
  const blockedAt = new Date(updatedAt);
  const ownerSection = opts.ownerBlocker
    ? "## Blocked on\n\nWaiting on owner decision between options A and B.\n"
    : "";
  const extraBody = opts.body ?? "";
  const path = join(dir, `${id}.md`);
  const content = `---\nstatus: blocked\npriority: p2\n---\n\n# ${id}\n\nTest.\n\n${ownerSection}${extraBody}`;
  writeFileSync(path, content, "utf-8");
  utimesSync(path, blockedAt, blockedAt);
}

function writeRunMetadata(
  runsDir: string,
  id: string,
  workflow: string,
  status: string,
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
      trigger: { event: "runtime.idle", schemaRef: null, payload: {} },
      startedAt: now,
      completedAt: now,
      status,
      durationMs: 1000,
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "unknown" },
      },
      runDir: `.kota/runs/${id}`,
      steps: [],
      ...(warnings ? { warnings } : {}),
    }),
    "utf-8",
  );
}

describe("attention digest inspection", () => {
  let workspaceRoot: string;
  let stateDir: string;
  let runsDir: string;
  let emittedEvents: Array<{ event: string; payload: Record<string, unknown> }>;
  let emit: (event: string, payload: Record<string, unknown>) => void;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-digest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    stateDir = join(workspaceRoot, ".kota");
    runsDir = join(stateDir, "runs");
    mkdirSync(runsDir, { recursive: true });
    emittedEvents = [];
    emit = (event, payload) => emittedEvents.push({ event, payload });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function runSteps(n: number): void {
    for (let count = 1; count <= n; count += 1) {
      const result = inspectAttentionDigestStep({ workspaceRoot, stateDir, runsDir, count });
      if (result.event) emit(result.event.name, result.event.payload);
    }
  }

  it("does not emit before 10 invocations", () => {
    runSteps(9);
    expect(emittedEvents).toHaveLength(0);
  });

  it("does not emit at 10 invocations when nothing warrants attention", () => {
    makeTaskDir(workspaceRoot, "open", 1);
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
    makeTaskDir(workspaceRoot, "open", 1);
    writeRunMetadata(runsDir, "2026-03-27-run-b", "builder", "failed");
    writeRunMetadata(runsDir, "2026-03-27-run-a", "builder", "failed");

    runSteps(10);
    expect(emittedEvents).toHaveLength(0);
  });

  it("emits digest when multiple tasks are blocked", () => {
    makeTaskDir(workspaceRoot, "blocked", 2);

    runSteps(10);
    expect(emittedEvents).toHaveLength(1);
    const text = emittedEvents[0].payload.text as string;
    expect(text).toContain("Blocked tasks");
    expect(text).toContain("2 blocked tasks");
  });

  it("emits digest when the open task queue is empty", () => {
    runSteps(10);
    expect(emittedEvents).toHaveLength(1);
    const text = emittedEvents[0].payload.text as string;
    expect(text).toContain("Empty task queue");
    expect(text).toContain("Builder has no open task to pick up");
  });

  it("does not emit when the open queue is populated and nothing else warrants attention", () => {
    makeTaskDir(workspaceRoot, "open", 1);
    runSteps(10);
    expect(emittedEvents).toHaveLength(0);
  });

  it("includes multiple attention items in one digest", () => {
    makeTaskDir(workspaceRoot, "open", 1);
    makeTaskDir(workspaceRoot, "blocked", 2);
    writeRunMetadata(runsDir, "2026-03-27-run-c", "builder", "failed");
    writeRunMetadata(runsDir, "2026-03-27-run-b", "builder", "failed");
    writeRunMetadata(runsDir, "2026-03-27-run-a", "builder", "failed");

    runSteps(10);
    expect(emittedEvents).toHaveLength(1);
    const text = emittedEvents[0].payload.text as string;
    expect(text).toContain("Builder failure streak");
    expect(text).toContain("Blocked tasks");
    expect(text).toContain("2 items");
  });

  it("emits digest every 10 invocations, not just once", () => {
    runSteps(20);
    expect(emittedEvents).toHaveLength(2);
  });

  it("digest text starts with attention digest header", () => {
    runSteps(10);
    const text = emittedEvents[0].payload.text as string;
    expect(text).toMatch(/^Attention digest \(\d+ items?\):/);
  });

  it("emits digest without emit callback (no-op, no throw)", () => {
    inspectAttentionDigestStep({ workspaceRoot, stateDir, runsDir, count: 10 });
    expect(emittedEvents).toHaveLength(0);
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
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
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
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      for (let i = 0; i < 2; i++) {
        writeRunMetadata(runsDir, `2026-04-01-warn-${i}`, "builder", "completed-with-warnings");
      }
      runSteps(10);
      expect(emittedEvents).toHaveLength(0);
    });

    it("respects custom N and M env vars", () => {
      process.env.KOTA_DIGEST_WARNINGS_COUNT = "2";
      process.env.KOTA_DIGEST_WARNINGS_WINDOW = "5";
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      for (let i = 0; i < 2; i++) {
        writeRunMetadata(runsDir, `2026-04-01-warn-${i}`, "builder", "completed-with-warnings");
      }
      runSteps(10);
      expect(emittedEvents).toHaveLength(1);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Repeated warnings");
    });

    it("includes warning type in detail when all warnings share the same type", () => {
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      const warnings = [{ type: "maxStepOutputBytes", message: "output truncated" }];
      for (let i = 0; i < 3; i++) {
        writeRunMetadata(runsDir, `2026-04-01-warn-${i}`, "builder", "completed-with-warnings", warnings);
      }
      runSteps(10);
      expect(emittedEvents).toHaveLength(1);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("maxStepOutputBytes");
    });

    it("does not include type in detail when warnings have mixed types", () => {
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      writeRunMetadata(runsDir, "2026-04-01-warn-0", "builder", "completed-with-warnings", [{ type: "typeA", message: "a" }]);
      writeRunMetadata(runsDir, "2026-04-01-warn-1", "builder", "completed-with-warnings", [{ type: "typeB", message: "b" }]);
      writeRunMetadata(runsDir, "2026-04-01-warn-2", "builder", "completed-with-warnings", [{ type: "typeA", message: "a2" }]);
      runSteps(10);
      expect(emittedEvents).toHaveLength(1);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Repeated warnings");
      expect(text).not.toContain("typeA");
      expect(text).not.toContain("typeB");
    });

    it("does not count non-builder warning runs", () => {
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
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
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      // Just under 3 days (default threshold) — floor(ageDays) = 2
      writeBlockedTask(workspaceRoot, "task-fresh-a", { daysAgo: 2.9 });
      writeBlockedTask(workspaceRoot, "task-fresh-b", { daysAgo: 1 });
      runSteps(10);
      expect(emittedEvents).toHaveLength(1);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Blocked tasks");
      expect(text).not.toContain("Stale blocker");
      expect(text).not.toContain("Owner decision pending");
    });

    it("surfaces a task sitting exactly at the threshold", () => {
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      // daysAgo=3 with default threshold=3 → floor(ageDays)=3 ≥ 3
      writeBlockedTask(workspaceRoot, "task-threshold", { daysAgo: 3 });
      writeBlockedTask(workspaceRoot, "task-fresh", { daysAgo: 1 });
      runSteps(10);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Stale blocker");
      expect(text).toContain("task-threshold");
      expect(text).toContain("blocked 3d");
      expect(text).toContain("Blocked tasks");
    });

    it("surfaces a task one day past the threshold", () => {
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      writeBlockedTask(workspaceRoot, "task-stale-a", { daysAgo: 4 });
      writeBlockedTask(workspaceRoot, "task-fresh-b", { daysAgo: 1 });
      runSteps(10);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Stale blocker");
      expect(text).toContain("task-stale-a");
      expect(text).toContain("blocked 4d");
      expect(text).toContain("Blocked tasks");
    });

    it("labels an owner-blocker task differently from a stale blocker", () => {
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      writeBlockedTask(workspaceRoot, "task-owner", {
        daysAgo: 5,
        ownerBlocker: true,
      });
      writeBlockedTask(workspaceRoot, "task-stale", { daysAgo: 4 });
      runSteps(10);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Owner decision pending");
      expect(text).toContain("task-owner");
      expect(text).toContain("Stale blocker");
      expect(text).toContain("task-stale");
    });

    it("suppresses the aggregate line when every blocked task is long-blocked", () => {
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      writeBlockedTask(workspaceRoot, "task-old-a", { daysAgo: 10 });
      writeBlockedTask(workspaceRoot, "task-old-b", { daysAgo: 5 });
      runSteps(10);
      const text = emittedEvents[0].payload.text as string;
      expect(text).not.toContain("Blocked tasks");
      expect(text).toContain("task-old-a");
      expect(text).toContain("task-old-b");
    });

    it("caps individual items at five and summarizes the tail", () => {
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      for (let i = 0; i < 7; i++) {
        writeBlockedTask(workspaceRoot, `task-old-${i}`, { daysAgo: 10 + i });
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
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      writeBlockedTask(workspaceRoot, "task-day-old", { daysAgo: 1 });
      runSteps(10);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Stale blocker");
      expect(text).toContain("task-day-old");
    });
  });

  describe("renderOnDemandAttention", () => {
    it("fails closed against a centralized active-run authority", () => {
      const runId = "2026-09-02T00-00-00-000Z-builder-central";
      writeRunMetadata(runsDir, runId, "builder", "success");
      const canonicalStateDir = join(workspaceRoot, "daemon-state");
      const runState = new RunStateDatabase(canonicalStateDir);
      try {
        runState.registerScope({
          id: "scope-central",
          rootPath: realpathSync(workspaceRoot),
          createdAt: new Date().toISOString(),
        });
        const { epoch } = runState.beginDaemonSession(new Date().toISOString());
        runState.admitRun({
          id: runId,
          scopeId: "scope-central",
          workflow: "builder",
          repository: "read",
          trigger: { event: "runtime.idle", schemaRef: null, payload: {} },
          resources: [],
          admittedAt: new Date().toISOString(),
        });
        runState.startRun(runId, epoch, new Date().toISOString());

        expect(() => renderOnDemandAttention({
          scopeRoot: workspaceRoot,
          runsDir,
          authority: {
            stateDir: canonicalStateDir,
            scopeRoot: workspaceRoot,
          },
        })).toThrow(/operationally active.*terminal evidence/i);
      } finally {
        runState.close();
      }
    });

    it("returns the same body cadence would emit when items exist", () => {
      // Drive the cadence so we can compare its emitted text against the
      // on-demand body for the exact same repo state.
      runSteps(10);
      expect(emittedEvents).toHaveLength(1);
      const cadenceText = emittedEvents[0].payload.text as string;

      const result = renderOnDemandAttention({
        scopeRoot: workspaceRoot,
        runsDir,
        authority: { stateDir, scopeRoot: workspaceRoot },
      });
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.text).toBe(cadenceText);
    });

    it("returns the short fixed reply when nothing warrants attention", () => {
      makeTaskDir(workspaceRoot, "open", 1);

      const result = renderOnDemandAttention({
        scopeRoot: workspaceRoot,
        runsDir,
        authority: { stateDir, scopeRoot: workspaceRoot },
      });
      expect(result.items).toEqual([]);
      expect(result.text).toBe(NO_ATTENTION_ITEMS_TEXT);
    });

    it("does not depend on cadence state", () => {
      expect(renderOnDemandAttention({
        scopeRoot: workspaceRoot,
        runsDir,
        authority: { stateDir, scopeRoot: workspaceRoot },
      }).items).toHaveLength(1);
    });

    it("does not emit workflow.attention.digest", () => {
      // Even though detection finds an item, the on-demand path must not emit.
      renderOnDemandAttention({
        scopeRoot: workspaceRoot,
        runsDir,
        authority: { stateDir, scopeRoot: workspaceRoot },
      });
      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe("operator-gated action-cooldown suppression", () => {
    afterEach(() => {
      delete process.env.KOTA_DIGEST_BLOCKED_AGE_DAYS;
      delete process.env.KOTA_DIGEST_BLOCKED_AGED_DAYS;
    });

    it("suppresses an aged owner-decision when a fresh ask marker is on the body", () => {
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      const recentAsk = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
      writeBlockedTask(workspaceRoot, "task-actioned-owner", {
        daysAgo: 20,
        body: [
          "## Blocked on",
          "",
          "```",
          "kind: owner-decision",
          "slot: pick-variant",
          "question: Which variant?",
          "context: ctx.",
          "```",
          "",
          `<!-- blocked-promoter-asked: slot=pick-variant last_asked_at=${recentAsk} -->`,
          "",
        ].join("\n"),
      });
      runSteps(10);
      const text = emittedEvents[0]?.payload.text as string | undefined;
      // The aged escalation row is suppressed because blocked-promoter already actioned the slot.
      expect(text ?? "").not.toContain("Operator-gated blocker aged");
      expect(text ?? "").not.toContain("task-actioned-owner");
    });

    it("suppresses an aged operator-capture when a fresh instructed marker is on the body", () => {
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      const recentInstruct = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
      writeBlockedTask(workspaceRoot, "task-actioned-capture", {
        daysAgo: 30,
        body: [
          "## Blocked on",
          "",
          "```",
          "kind: operator-capture",
          "path: .kota/runs/x",
          "description: y",
          "```",
          "",
          `<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=${recentInstruct} -->`,
          "",
        ].join("\n"),
      });
      runSteps(10);
      const text = emittedEvents[0]?.payload.text as string | undefined;
      expect(text ?? "").not.toContain("Operator-gated blocker aged");
      expect(text ?? "").not.toContain("task-actioned-capture");
    });

    it("surfaces an aged operator-capture again once the marker ages past 14 days", () => {
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      const staleInstruct = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
      writeBlockedTask(workspaceRoot, "task-stale-marker", {
        daysAgo: 60,
        body: [
          "## Blocked on",
          "",
          "```",
          "kind: operator-capture",
          "path: .kota/runs/x",
          "description: y",
          "```",
          "",
          `<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=${staleInstruct} -->`,
          "",
        ].join("\n"),
      });
      runSteps(10);
      const text = emittedEvents[0].payload.text as string;
      expect(text).toContain("Operator-gated blocker aged");
      expect(text).toContain("task-stale-marker");
    });
  });

  describe("operator-gated precondition aging", () => {
    afterEach(() => {
      delete process.env.KOTA_DIGEST_BLOCKED_AGE_DAYS;
      delete process.env.KOTA_DIGEST_BLOCKED_AGED_DAYS;
    });

    it("surfaces an aged owner-decision precondition past 14 days", () => {
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      writeBlockedTask(workspaceRoot, "task-aged-owner", {
        daysAgo: 20,
        body: [
          "## Blocked on",
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
      makeTaskDir(workspaceRoot, "open", 1);
      makeTaskDir(workspaceRoot, "open", 1);
      writeBlockedTask(workspaceRoot, "task-fresh-capture", {
        daysAgo: 5,
        body: [
          "## Blocked on",
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

  });

});
