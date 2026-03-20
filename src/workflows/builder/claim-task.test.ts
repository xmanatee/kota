import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimTask, isClaimTaskResult } from "./claim-task.js";

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

function makeTaskContent(id: string, priority: string, status = "ready"): string {
  return `---
id: ${id}
title: Test task ${id}
status: ${status}
priority: ${priority}
area: workflow
summary: A test task.
created_at: 2026-03-20
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

  it("leaves other ready tasks untouched", () => {
    writeFileSync(join(readyDir, "task-a.md"), makeTaskContent("task-a", "p1"));
    writeFileSync(join(readyDir, "task-b.md"), makeTaskContent("task-b", "p3"));
    claimTask(projectDir);
    expect(existsSync(join(readyDir, "task-b.md"))).toBe(true);
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
