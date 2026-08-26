import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import backlogPromoterWorkflow from "./workflow.js";

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: vi.fn(),
}));

const roots: string[] = [];

function makeScopeRoot(): { workspaceRoot: string; outsidePath: string } {
  const root = mkdtempSync(join(tmpdir(), "backlog-promoter-path-safety-"));
  roots.push(root);
  const workspaceRoot = join(root, "project");
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(workspaceRoot, "data", "tasks", state), { recursive: true });
    writeFileSync(join(workspaceRoot, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
  execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: workspaceRoot,
  });
  execFileSync("git", ["config", "user.name", "test"], { cwd: workspaceRoot });
  return { workspaceRoot, outsidePath: join(root, "outside-host-target.md") };
}

function taskTemplate(id: string): string {
  return `---
id: ${id}
title: ${id}
status: backlog
priority: p1
area: security
summary: ${id} summary
created_at: 2026-04-01T00:00:00.000Z
updated_at: 2026-04-01T00:00:00.000Z
---

## Problem
Body.

## Desired Outcome
Outcome.

## Constraints
Constraints.

## Done When
- when

## Source / Intent
Security review.

## Initiative
Safety.

## Acceptance Evidence
- Tests.
`;
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
  vi.mocked(getRepoWorktreeStatus).mockReturnValue({
    available: true,
    dirty: false,
    trackedDirty: false,
    entries: [],
    fingerprint: "",
    summary: "clean",
    headSha: "abc1234",
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("backlog-promoter task path safety", () => {
  it("rejects a symlinked task in the autonomous host promotion step", async () => {
    const { workspaceRoot, outsidePath } = makeScopeRoot();
    const taskId = "task-linked-host-promotion";
    const outsideContent = taskTemplate(taskId);
    writeFileSync(outsidePath, outsideContent, "utf-8");
    const linkedTaskPath = join(
      workspaceRoot,
      "data",
      "tasks",
      "backlog",
      `${taskId}.md`,
    );
    symlinkSync(outsidePath, linkedTaskPath);
    execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
    execFileSync("git", ["commit", "-m", "initial", "--quiet"], {
      cwd: workspaceRoot,
    });

    const harness = new WorkflowTestHarness(backlogPromoterWorkflow, {
      trigger: { event: "autonomy.queue.needs-promotion", payload: {} },
      workspaceRoot,
    });
    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps["inspect-backlog"].status).toBe("failed");
    expect(result.steps["inspect-backlog"].error).toMatch(
      /symbolic-link markdown entries are forbidden/,
    );
    expect(result.steps["apply-promotion"]).toBeUndefined();
    expect(readFileSync(outsidePath, "utf-8")).toBe(outsideContent);
    expect(lstatSync(linkedTaskPath).isSymbolicLink()).toBe(true);
    expect(
      existsSync(join(workspaceRoot, "data", "tasks", "ready", `${taskId}.md`)),
    ).toBe(false);
  });
});
