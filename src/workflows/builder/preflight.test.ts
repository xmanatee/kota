import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isBuilderPreflightResult,
  runBuilderPreflight,
  validateReadyTask,
} from "./preflight.js";

const VALID_TASK = `---
id: task-foo-bar
title: Foo Bar
status: ready
priority: p2
area: workflow
summary: A clear summary of the task.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

There is a problem.

## Desired Outcome

The problem is solved.

## Constraints

None.

## Done When

The problem is gone.
`;

describe("validateReadyTask", () => {
  it("accepts a well-formed task", () => {
    expect(validateReadyTask("task-foo-bar.md", VALID_TASK)).toEqual({ valid: true });
  });

  it("rejects a task with no frontmatter", () => {
    const result = validateReadyTask("task-bad.md", "## Problem\nFoo");
    expect(result.valid).toBe(false);
  });

  it("rejects a task missing a required frontmatter key", () => {
    const content = VALID_TASK.replace(/^area:.*\n/m, "");
    const result = validateReadyTask("task-bad.md", content);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/area/);
  });

  it("rejects a task with an empty frontmatter key", () => {
    const content = VALID_TASK.replace(/^summary:.+$/m, "summary:   ");
    const result = validateReadyTask("task-bad.md", content);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/summary/);
  });

  it("rejects a task missing ## Problem section", () => {
    const content = VALID_TASK.replace("## Problem\n\nThere is a problem.\n", "");
    const result = validateReadyTask("task-bad.md", content);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/Problem/);
  });

  it("rejects a task with empty ## Done When section", () => {
    const content = VALID_TASK.replace("## Done When\n\nThe problem is gone.\n", "## Done When\n\n   \n");
    const result = validateReadyTask("task-bad.md", content);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/Done When/);
  });

  it("rejects a task missing ## Desired Outcome section", () => {
    const content = VALID_TASK.replace(
      "## Desired Outcome\n\nThe problem is solved.\n",
      "",
    );
    const result = validateReadyTask("task-bad.md", content);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/Desired Outcome/);
  });
});

describe("runBuilderPreflight", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-preflight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "tasks", "ready"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns validCount=0 when ready dir is empty", () => {
    const result = runBuilderPreflight(projectDir);
    expect(result).toEqual({ validCount: 0, invalidTasks: [] });
  });

  it("returns validCount=0 and no errors when ready dir does not exist", () => {
    rmSync(join(projectDir, "tasks", "ready"), { recursive: true });
    const result = runBuilderPreflight(projectDir);
    expect(result).toEqual({ validCount: 0, invalidTasks: [] });
  });

  it("counts a valid task file", () => {
    writeFileSync(join(projectDir, "tasks", "ready", "task-foo.md"), VALID_TASK);
    const result = runBuilderPreflight(projectDir);
    expect(result.validCount).toBe(1);
    expect(result.invalidTasks).toHaveLength(0);
  });

  it("records invalid tasks and does not count them", () => {
    writeFileSync(join(projectDir, "tasks", "ready", "task-bad.md"), "no frontmatter");
    const result = runBuilderPreflight(projectDir);
    expect(result.validCount).toBe(0);
    expect(result.invalidTasks).toHaveLength(1);
    expect(result.invalidTasks[0].file).toBe("task-bad.md");
  });

  it("mixes valid and invalid tasks correctly", () => {
    writeFileSync(join(projectDir, "tasks", "ready", "task-good.md"), VALID_TASK);
    writeFileSync(join(projectDir, "tasks", "ready", "task-bad.md"), "no frontmatter");
    const result = runBuilderPreflight(projectDir);
    expect(result.validCount).toBe(1);
    expect(result.invalidTasks).toHaveLength(1);
  });

  it("ignores AGENTS.md", () => {
    writeFileSync(join(projectDir, "tasks", "ready", "AGENTS.md"), "# AGENTS\nSome content");
    const result = runBuilderPreflight(projectDir);
    expect(result.validCount).toBe(0);
    expect(result.invalidTasks).toHaveLength(0);
  });
});

describe("isBuilderPreflightResult", () => {
  it("returns true for valid shape", () => {
    expect(isBuilderPreflightResult({ validCount: 1, invalidTasks: [] })).toBe(true);
  });

  it("returns false for missing validCount", () => {
    expect(isBuilderPreflightResult({ invalidTasks: [] })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isBuilderPreflightResult(null)).toBe(false);
  });
});
