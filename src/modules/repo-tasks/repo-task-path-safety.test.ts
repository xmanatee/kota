import { execFileSync } from "node:child_process";
import {
  existsSync,
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
import {
  createNormalizedTask,
  gcTerminalTasks,
  updateTaskBody,
} from "./repo-tasks-operations.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync: vi.fn(),
}));

const roots: string[] = [];

function makeProjectFixture(): { projectDir: string; outsideDir: string } {
  const root = mkdtempSync(join(tmpdir(), "kota-task-path-safety-"));
  roots.push(root);
  const projectDir = join(root, "project");
  mkdirSync(projectDir);
  const outsideDir = join(root, "outside");
  mkdirSync(outsideDir);
  return { projectDir, outsideDir };
}

beforeEach(() => {
  vi.mocked(execFileSync).mockReset();
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("canonical task mutation path safety", () => {
  it("rejects a direct task symlink before updating its external target", () => {
    const { projectDir, outsideDir } = makeProjectFixture();
    const outsidePath = join(outsideDir, "outside-task.md");
    const outsideContent = `---
id: task-linked
title: Linked task
status: ready
priority: p1
area: security
summary: Must remain unchanged.
created_at: 2026-08-06
updated_at: 2026-08-06
---

## Problem

External target.
`;
    writeFileSync(outsidePath, outsideContent, "utf-8");
    const readyDir = join(projectDir, "data", "tasks", "ready");
    mkdirSync(readyDir, { recursive: true });
    symlinkSync(outsidePath, join(readyDir, "task-linked.md"));

    expect(() =>
      updateTaskBody(projectDir, "task-linked", "## Problem\n\nChanged."),
    ).toThrow(/symbolic-link markdown entries are forbidden/);
    expect(readFileSync(outsidePath, "utf-8")).toBe(outsideContent);
  });

  it("rejects a symlinked task-state directory before creating outside the project", () => {
    const { projectDir, outsideDir } = makeProjectFixture();
    const tasksDir = join(projectDir, "data", "tasks");
    mkdirSync(tasksDir, { recursive: true });
    symlinkSync(outsideDir, join(tasksDir, "backlog"), "dir");

    expect(() =>
      createNormalizedTask(projectDir, {
        title: "Escaping parent",
        priority: "p1",
        area: "security",
        state: "backlog",
      }),
    ).toThrow(/symbolic-link directory components are forbidden/);
    expect(existsSync(join(outsideDir, "task-escaping-parent.md"))).toBe(false);
  });

  it("rejects a non-regular markdown entry", () => {
    const { projectDir } = makeProjectFixture();
    const backlogDir = join(projectDir, "data", "tasks", "backlog");
    mkdirSync(join(backlogDir, "task-directory-entry.md"), {
      recursive: true,
    });

    expect(() =>
      createNormalizedTask(projectDir, {
        title: "Directory entry",
        priority: "p1",
        area: "security",
        state: "backlog",
      }),
    ).toThrow(/markdown entries must be regular files/);
  });

  it("rejects a symlinked terminal-state directory before deletion", () => {
    const { projectDir, outsideDir } = makeProjectFixture();
    const outsidePath = join(outsideDir, "task-old-linked.md");
    const outsideContent = `---
id: task-old-linked
title: Linked terminal task
status: done
updated_at: 2020-01-01
---

## Done
`;
    writeFileSync(outsidePath, outsideContent, "utf-8");
    const tasksDir = join(projectDir, "data", "tasks");
    mkdirSync(tasksDir, { recursive: true });
    symlinkSync(outsideDir, join(tasksDir, "done"), "dir");

    expect(() =>
      gcTerminalTasks(projectDir, { days: 30 }),
    ).toThrow(/symbolic-link directory components are forbidden/);
    expect(readFileSync(outsidePath, "utf-8")).toBe(outsideContent);
  });
});
