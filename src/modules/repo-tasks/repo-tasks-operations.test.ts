import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RepoTaskState } from "./repo-tasks-domain.js";
import {
  captureInboxTask,
  createNormalizedTask,
  showTask,
  slugifyTaskTitle,
} from "./repo-tasks-operations.js";

function makeScopeRoot(): string {
  const dir = join(
    tmpdir(),
    `kota-task-ops-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

function writeTaskFile(
  repoRoot: string,
  state: RepoTaskState,
  id: string,
  extra: Record<string, string> = {},
): void {
  const dir = state === "done" || state === "dropped"
    ? join(repoRoot, "data", "tasks", "archive")
    : join(repoRoot, "data", "tasks");
  mkdirSync(dir, { recursive: true });
  const fm = state === "done" || state === "dropped"
    ? { status: state }
    : { status: state, priority: "p2", ...extra };
  const frontmatter = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const content = `---\n${frontmatter}\n---\n\n# Title for ${id}\n\n## Problem\n\nTest.\n`;
  writeFileSync(join(dir, `${id}.md`), content);
}

describe("slugifyTaskTitle", () => {
  it("converts title to kebab slug", () => {
    expect(slugifyTaskTitle("Add search filter")).toBe("add-search-filter");
  });

  it("strips non-alphanumeric characters", () => {
    expect(slugifyTaskTitle("Fix: auth/redirect!")).toBe("fix-authredirect");
  });

  it("truncates at 50 characters", () => {
    expect(slugifyTaskTitle("a".repeat(60)).length).toBe(50);
  });

  it("does not leave a trailing separator after truncation", () => {
    expect(
      slugifyTaskTitle("Regress improver failure escalation and attention reporting"),
    ).toBe("regress-improver-failure-escalation-and-attention");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(slugifyTaskTitle("   ")).toBe("");
  });
});

describe("showTask", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("returns { found: false } when task does not exist", () => {
    expect(showTask(repoRoot, "task-missing")).toEqual({ found: false });
  });

  it("finds task in any state and returns its content + state", () => {
    writeTaskFile(repoRoot, "open", "task-foo");
    const result = showTask(repoRoot, "task-foo");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.state).toBe("open");
      expect(result.content).toContain("# Title for task-foo");
    }
  });

  it("rejects traversal-shaped task ids before reading task-state paths", () => {
    writeFileSync(join(repoRoot, "AGENTS.md"), "# outside task queue\n");

    const result = showTask(repoRoot, "../../../AGENTS");

    expect(result).toEqual({ found: false });
  });
});

describe("createNormalizedTask", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("writes a normalized task file with minimal metadata and an intent template", () => {
    const result = createNormalizedTask(repoRoot, {
      title: "My new task",
      priority: "p2",
      state: "open",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toBe("task-my-new-task");
      const content = readFileSync(join(repoRoot, result.path), "utf-8");
      expect(content).toContain("# My new task");
      expect(content).toContain("priority: p2");
      expect(content).toContain("status: open");
      expect(content).not.toContain("id:");
      expect(content).not.toContain("title:");
      expect(content).toContain("## Problem");
      expect(content).toContain("## How We Will Know");
    }
  });

  it("treats project path metacharacters as literal filesystem content", () => {
    const unsafeScopeRoot = join(repoRoot, 'repo "$(touch should-not-run)" ;');
    mkdirSync(unsafeScopeRoot, { recursive: true });

    const result = createNormalizedTask(unsafeScopeRoot, {
      title: "Literal path task",
      priority: "p2",
      state: "open",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe("data/tasks/task-literal-path-task.md");
      expect(readFileSync(join(unsafeScopeRoot, result.path), "utf8")).toContain(
        "# Literal path task",
      );
    }
  });

  it("returns invalid_slug for empty title", () => {
    const result = createNormalizedTask(repoRoot, {
      title: "   ",
      priority: "p2",
      state: "open",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_slug");
  });

  it("returns already_exists when file already exists", () => {
    createNormalizedTask(repoRoot, {
      title: "Dup",
      priority: "p2",
      state: "open",
    });
    const second = createNormalizedTask(repoRoot, {
      title: "Dup",
      priority: "p2",
      state: "open",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_exists");
  });
});

describe("captureInboxTask", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("creates a new inbox task file", () => {
    const result = captureInboxTask(repoRoot, "Add search filter");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const content = readFileSync(join(repoRoot, result.path), "utf-8");
      expect(content).toBe("# Add search filter\n");
    }
  });

  it("returns already_exists when inbox file is present", () => {
    captureInboxTask(repoRoot, "Same title");
    const second = captureInboxTask(repoRoot, "Same title");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_exists");
  });

  it("returns invalid_slug for empty title", () => {
    const result = captureInboxTask(repoRoot, "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_slug");
  });
});
