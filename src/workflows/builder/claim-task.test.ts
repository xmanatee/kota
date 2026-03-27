import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimTask, isClaimTaskResult, parseLastAttemptRunId, parseRunIdTimestamp } from "./claim-task.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn((cmd: string) => {
    // Simulate git mv: rename the file on disk
    const mvMatch = cmd.match(/^git mv "(.+)" "(.+)"$/);
    if (mvMatch) {
      renameSync(mvMatch[1], mvMatch[2]);
    }
    return Buffer.from("");
  }),
}));

function makeTaskContent(id: string, priority: string, status = "ready", createdAt = "2026-03-20"): string {
  return `---
id: ${id}
title: Test task ${id}
status: ${status}
priority: ${priority}
area: workflow
summary: A test task.
created_at: ${createdAt}
updated_at: 2026-03-20
---

## Problem

Test problem.

## Desired Outcome

Test outcome.

## Done When

- It works.
`;
}

describe("claimTask", () => {
  let projectDir: string;
  let readyDir: string;
  let doingDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-claim-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    readyDir = join(projectDir, "tasks", "ready");
    doingDir = join(projectDir, "tasks", "doing");
    mkdirSync(readyDir, { recursive: true });
    mkdirSync(doingDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns null when ready directory does not exist", () => {
    rmSync(readyDir, { recursive: true });
    const result = claimTask(projectDir);
    expect(result).toBeNull();
  });

  it("returns null when ready directory is empty", () => {
    const result = claimTask(projectDir);
    expect(result).toBeNull();
  });

  it("returns null when only AGENTS.md is present", () => {
    writeFileSync(join(readyDir, "AGENTS.md"), "# AGENTS");
    const result = claimTask(projectDir);
    expect(result).toBeNull();
  });

  it("claims a single ready task and returns its ID", () => {
    writeFileSync(join(readyDir, "task-foo.md"), makeTaskContent("task-foo", "p2"));
    const result = claimTask(projectDir);
    expect(result).toEqual({ chosenTaskId: "task-foo" });
  });

  it("moves the task file from ready to doing", () => {
    writeFileSync(join(readyDir, "task-foo.md"), makeTaskContent("task-foo", "p2"));
    claimTask(projectDir);
    expect(existsSync(join(readyDir, "task-foo.md"))).toBe(false);
    expect(existsSync(join(doingDir, "task-foo.md"))).toBe(true);
  });

  it("updates status from ready to doing in the moved file", () => {
    writeFileSync(join(readyDir, "task-foo.md"), makeTaskContent("task-foo", "p2"));
    claimTask(projectDir);
    const content = readFileSync(join(doingDir, "task-foo.md"), "utf-8");
    expect(content).toMatch(/^status: doing$/m);
    expect(content).not.toMatch(/^status: ready$/m);
  });

  it("picks highest priority task when multiple tasks exist", () => {
    writeFileSync(join(readyDir, "task-low.md"), makeTaskContent("task-low", "p3"));
    writeFileSync(join(readyDir, "task-high.md"), makeTaskContent("task-high", "p1"));
    writeFileSync(join(readyDir, "task-mid.md"), makeTaskContent("task-mid", "p2"));
    const result = claimTask(projectDir);
    expect(result?.chosenTaskId).toBe("task-high");
  });

  it("picks p0 over all other priorities", () => {
    writeFileSync(join(readyDir, "task-p1.md"), makeTaskContent("task-p1", "p1"));
    writeFileSync(join(readyDir, "task-p0.md"), makeTaskContent("task-p0", "p0"));
    const result = claimTask(projectDir);
    expect(result?.chosenTaskId).toBe("task-p0");
  });

  it("breaks priority ties by created_at, preferring older tasks", () => {
    writeFileSync(join(readyDir, "task-newer.md"), makeTaskContent("task-newer", "p2", "ready", "2026-03-22"));
    writeFileSync(join(readyDir, "task-older.md"), makeTaskContent("task-older", "p2", "ready", "2026-03-20"));
    const result = claimTask(projectDir);
    expect(result?.chosenTaskId).toBe("task-older");
  });

  it("leaves other ready tasks untouched", () => {
    writeFileSync(join(readyDir, "task-a.md"), makeTaskContent("task-a", "p1"));
    writeFileSync(join(readyDir, "task-b.md"), makeTaskContent("task-b", "p3"));
    claimTask(projectDir);
    expect(existsSync(join(readyDir, "task-b.md"))).toBe(true);
  });
});

describe("cooldown logic", () => {
  let projectDir: string;
  let readyDir: string;
  let doingDir: string;
  let runsDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-cooldown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    readyDir = join(projectDir, "tasks", "ready");
    doingDir = join(projectDir, "tasks", "doing");
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(readyDir, { recursive: true });
    mkdirSync(doingDir, { recursive: true });
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function makeAttemptHistory(runId: string): string {
    const date = runId.slice(0, 10);
    return `\n\n## Attempt History\n- ${date} | ${runId} | build agent completed but task not moved to done\n`;
  }

  function makeRunDir(runId: string): void {
    mkdirSync(join(runsDir, runId), { recursive: true });
  }

  it("task without attempt history is eligible (not in cooldown)", () => {
    writeFileSync(join(readyDir, "task-clean.md"), makeTaskContent("task-clean", "p2"));
    writeFileSync(
      join(readyDir, "task-attempted.md"),
      makeTaskContent("task-attempted", "p1") +
        makeAttemptHistory("2026-03-27T05-00-00-000Z-builder-aaaaaa"),
    );
    // now = 1 minute after attempt, runs = 0 → task-attempted is in cooldown
    // task-clean has no history → eligible; should be picked despite lower priority
    const now = new Date("2026-03-27T05:01:00.000Z");
    const result = claimTask(projectDir, now);
    expect(result?.chosenTaskId).toBe("task-clean");
  });

  it("task with recent attempt is in cooldown; eligible task is preferred", () => {
    const attemptRunId = "2026-03-27T05-00-00-000Z-builder-aaaaaa";
    writeFileSync(
      join(readyDir, "task-hot.md"),
      makeTaskContent("task-hot", "p1") + makeAttemptHistory(attemptRunId),
    );
    writeFileSync(join(readyDir, "task-cool.md"), makeTaskContent("task-cool", "p2"));
    // 5 minutes elapsed, 0 builder runs → task-hot is in cooldown
    const now = new Date("2026-03-27T05:05:00.000Z");
    const result = claimTask(projectDir, now);
    expect(result?.chosenTaskId).toBe("task-cool");
  });

  it("task exits time cooldown but stays in cooldown until 2 builder runs pass", () => {
    const attemptRunId = "2026-03-27T05-00-00-000Z-builder-aaaaaa";
    writeFileSync(
      join(readyDir, "task-a.md"),
      makeTaskContent("task-a", "p1") + makeAttemptHistory(attemptRunId),
    );
    writeFileSync(join(readyDir, "task-b.md"), makeTaskContent("task-b", "p2"));
    // 15 minutes elapsed (past 10min) but only 1 builder run → still in cooldown
    makeRunDir("2026-03-27T05-10-00-000Z-builder-bbbbbb");
    const now = new Date("2026-03-27T05:15:00.000Z");
    const result = claimTask(projectDir, now);
    expect(result?.chosenTaskId).toBe("task-b");
  });

  it("task is eligible after both time and run cooldown expire", () => {
    const attemptRunId = "2026-03-27T05-00-00-000Z-builder-aaaaaa";
    writeFileSync(
      join(readyDir, "task-a.md"),
      makeTaskContent("task-a", "p1") + makeAttemptHistory(attemptRunId),
    );
    writeFileSync(join(readyDir, "task-b.md"), makeTaskContent("task-b", "p2"));
    // 15 minutes elapsed AND 2 builder runs → cooldown expired
    makeRunDir("2026-03-27T05-05-00-000Z-builder-bbbbbb");
    makeRunDir("2026-03-27T05-10-00-000Z-builder-cccccc");
    const now = new Date("2026-03-27T05:15:00.000Z");
    const result = claimTask(projectDir, now);
    // task-a is p1 (higher priority) and now eligible
    expect(result?.chosenTaskId).toBe("task-a");
  });

  it("when all tasks are in cooldown, picks least-recently-attempted", () => {
    const olderRunId = "2026-03-27T04-50-00-000Z-builder-aaaaaa";
    const newerRunId = "2026-03-27T04-55-00-000Z-builder-bbbbbb";
    writeFileSync(
      join(readyDir, "task-newer.md"),
      makeTaskContent("task-newer", "p1") + makeAttemptHistory(newerRunId),
    );
    writeFileSync(
      join(readyDir, "task-older.md"),
      makeTaskContent("task-older", "p2") + makeAttemptHistory(olderRunId),
    );
    // Both attempted recently (5-10 min ago, 0 runs) → both in cooldown
    const now = new Date("2026-03-27T05:00:00.000Z");
    const result = claimTask(projectDir, now);
    // task-older has earlier attempt → picked as fallback
    expect(result?.chosenTaskId).toBe("task-older");
  });

  it("unparseable attempt history means task is eligible", () => {
    const garbled = "\n\n## Attempt History\n- invalid line without pipe separators\n";
    writeFileSync(
      join(readyDir, "task-garbled.md"),
      makeTaskContent("task-garbled", "p1") + garbled,
    );
    writeFileSync(join(readyDir, "task-normal.md"), makeTaskContent("task-normal", "p2"));
    const now = new Date("2026-03-27T05:00:00.000Z");
    const result = claimTask(projectDir, now);
    // task-garbled is p1 and eligible (unparseable = no cooldown)
    expect(result?.chosenTaskId).toBe("task-garbled");
  });
});

describe("parseLastAttemptRunId", () => {
  it("returns null when no attempt history section", () => {
    expect(parseLastAttemptRunId("## Problem\n\nSome content\n")).toBeNull();
  });

  it("returns null when attempt history section is empty", () => {
    expect(parseLastAttemptRunId("## Attempt History\n\n## Done When\n")).toBeNull();
  });

  it("extracts run ID from last attempt line", () => {
    const content =
      "## Attempt History\n- 2026-03-27 | 2026-03-27T05-00-00-000Z-builder-aaaaaa | failed\n";
    expect(parseLastAttemptRunId(content)).toBe("2026-03-27T05-00-00-000Z-builder-aaaaaa");
  });

  it("extracts run ID from last of multiple attempt lines", () => {
    const content =
      "## Attempt History\n- 2026-03-26 | 2026-03-26T10-00-00-000Z-builder-first | failed\n- 2026-03-27 | 2026-03-27T05-00-00-000Z-builder-second | failed again\n";
    expect(parseLastAttemptRunId(content)).toBe("2026-03-27T05-00-00-000Z-builder-second");
  });
});

describe("parseRunIdTimestamp", () => {
  it("returns null for invalid format", () => {
    expect(parseRunIdTimestamp("not-a-run-id")).toBeNull();
  });

  it("parses valid run ID to Date", () => {
    const d = parseRunIdTimestamp("2026-03-27T05-36-54-005Z-builder-j3iz2l");
    expect(d?.toISOString()).toBe("2026-03-27T05:36:54.005Z");
  });
});

describe("isClaimTaskResult", () => {
  it("returns true for valid result", () => {
    expect(isClaimTaskResult({ chosenTaskId: "task-foo" })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isClaimTaskResult(null)).toBe(false);
  });

  it("returns false when chosenTaskId is missing", () => {
    expect(isClaimTaskResult({})).toBe(false);
  });

  it("returns false when chosenTaskId is not a string", () => {
    expect(isClaimTaskResult({ chosenTaskId: 42 })).toBe(false);
  });
});
