import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyClaim } from "./verify-claim.js";

function makeTaskContent(id: string, status: string): string {
  return `---
id: ${id}
title: Test task ${id}
status: ${status}
priority: p2
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

describe("verifyClaim", () => {
  let projectDir: string;
  let doingDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-verify-claim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    doingDir = join(projectDir, "tasks", "doing");
    mkdirSync(doingDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns verified result when task exists in doing/ with correct status", () => {
    writeFileSync(
      join(doingDir, "task-foo.md"),
      makeTaskContent("task-foo", "doing"),
    );
    const result = verifyClaim(projectDir, "task-foo");
    expect(result).toEqual({ taskId: "task-foo", verified: true });
  });

  it("throws when task file is missing from doing/", () => {
    expect(() => verifyClaim(projectDir, "task-missing")).toThrow(
      /task file not found in doing\//,
    );
  });

  it("throws when task file has wrong status", () => {
    writeFileSync(
      join(doingDir, "task-bar.md"),
      makeTaskContent("task-bar", "done"),
    );
    expect(() => verifyClaim(projectDir, "task-bar")).toThrow(
      /has status "done", expected "doing"/,
    );
  });
});
