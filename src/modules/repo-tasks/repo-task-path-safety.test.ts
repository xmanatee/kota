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
  updateTaskBody,
} from "./repo-tasks-operations.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync: vi.fn(),
}));

const roots: string[] = [];

function makeProjectFixture(): { repoRoot: string; outsideDir: string } {
  const root = mkdtempSync(join(tmpdir(), "kota-task-path-safety-"));
  roots.push(root);
  const repoRoot = join(root, "project");
  mkdirSync(repoRoot);
  const outsideDir = join(root, "outside");
  mkdirSync(outsideDir);
  return { repoRoot, outsideDir };
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
    const { repoRoot, outsideDir } = makeProjectFixture();
    const outsidePath = join(outsideDir, "outside-task.md");
    const outsideContent = `---
status: open
priority: p1
---

# Linked task

## Problem

External target.
`;
    writeFileSync(outsidePath, outsideContent, "utf-8");
    const tasksDir = join(repoRoot, "data", "tasks");
    mkdirSync(tasksDir, { recursive: true });
    symlinkSync(outsidePath, join(tasksDir, "task-linked.md"));

    expect(() =>
      updateTaskBody(repoRoot, "task-linked", "## Problem\n\nChanged."),
    ).toThrow(/symbolic-link markdown entries are forbidden/);
    expect(readFileSync(outsidePath, "utf-8")).toBe(outsideContent);
  });

  it("rejects a symlinked task directory before creating outside the project", () => {
    const { repoRoot, outsideDir } = makeProjectFixture();
    const dataDir = join(repoRoot, "data");
    mkdirSync(dataDir, { recursive: true });
    symlinkSync(outsideDir, join(dataDir, "tasks"), "dir");

    expect(() =>
      createNormalizedTask(repoRoot, {
        title: "Escaping parent",
        priority: "p1",
        state: "open",
      }),
    ).toThrow(/symbolic-link directory components are forbidden/);
    expect(existsSync(join(outsideDir, "task-escaping-parent.md"))).toBe(false);
  });

  it("rejects a non-regular markdown entry", () => {
    const { repoRoot } = makeProjectFixture();
    const tasksDir = join(repoRoot, "data", "tasks");
    mkdirSync(join(tasksDir, "task-directory-entry.md"), {
      recursive: true,
    });

    expect(() =>
      createNormalizedTask(repoRoot, {
        title: "Directory entry",
        priority: "p1",
        state: "open",
      }),
    ).toThrow(/markdown entries must be regular files/);
  });

});
