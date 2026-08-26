import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureInboxTask,
  createNormalizedTask,
  gcTerminalTasks,
  showTask,
  slugifyTaskTitle,
} from "./repo-tasks-operations.js";

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-task-ops-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

function writeTaskFile(
  projectDir: string,
  state: string,
  id: string,
  extra: Record<string, string> = {},
): void {
  const dir = join(projectDir, "data", "tasks", state);
  mkdirSync(dir, { recursive: true });
  const fm = {
    id,
    title: `Title for ${id}`,
    status: state,
    priority: "p2",
    area: "test",
    summary: "A test task.",
    created_at: "2026-03-20",
    updated_at: "2026-03-20",
    ...extra,
  };
  const frontmatter = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const content = `---\n${frontmatter}\n---\n\n## Problem\n\nTest.\n`;
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
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns { found: false } when task does not exist", () => {
    expect(showTask(projectDir, "task-missing")).toEqual({ found: false });
  });

  it("finds task in any state and returns its content + state", () => {
    writeTaskFile(projectDir, "backlog", "task-foo");
    const result = showTask(projectDir, "task-foo");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.state).toBe("backlog");
      expect(result.content).toContain("id: task-foo");
    }
  });

  it("rejects traversal-shaped task ids before reading task-state paths", () => {
    writeFileSync(join(projectDir, "AGENTS.md"), "# outside task queue\n");

    const result = showTask(projectDir, "../../../AGENTS");

    expect(result).toEqual({ found: false });
  });
});

describe("createNormalizedTask", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("writes a normalized task file with full template", () => {
    const result = createNormalizedTask(projectDir, {
      title: "My new task",
      priority: "p2",
      area: "core",
      state: "backlog",
      summary: "summary",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toBe("task-my-new-task");
      const content = readFileSync(result.path, "utf-8");
      expect(content).toContain("id: task-my-new-task");
      expect(content).toContain("priority: p2");
      expect(content).toContain("status: backlog");
      expect(content).toContain("## Problem");
      expect(content).toContain("## Done When");
    }
  });

  it("treats project path metacharacters as literal filesystem content", () => {
    const unsafeProjectDir = join(projectDir, 'repo "$(touch should-not-run)" ;');
    mkdirSync(unsafeProjectDir, { recursive: true });

    const result = createNormalizedTask(unsafeProjectDir, {
      title: "Literal path task",
      priority: "p2",
      area: "core",
      state: "backlog",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toContain('$(touch should-not-run)');
      expect(readFileSync(result.path, "utf8")).toContain("id: task-literal-path-task");
    }
  });

  it("returns invalid_slug for empty title", () => {
    const result = createNormalizedTask(projectDir, {
      title: "   ",
      priority: "p2",
      area: "core",
      state: "backlog",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_slug");
  });

  it("returns already_exists when file already exists", () => {
    createNormalizedTask(projectDir, {
      title: "Dup",
      priority: "p2",
      area: "core",
      state: "backlog",
    });
    const second = createNormalizedTask(projectDir, {
      title: "Dup",
      priority: "p2",
      area: "core",
      state: "backlog",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_exists");
  });
});

describe("captureInboxTask", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("creates a new inbox task file", () => {
    const result = captureInboxTask(projectDir, "Add search filter");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const content = readFileSync(result.path, "utf-8");
      expect(content).toBe("# Add search filter\n");
    }
  });

  it("returns already_exists when inbox file is present", () => {
    captureInboxTask(projectDir, "Same title");
    const second = captureInboxTask(projectDir, "Same title");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_exists");
  });

  it("returns invalid_slug for empty title", () => {
    const result = captureInboxTask(projectDir, "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_slug");
  });
});

describe("gcTerminalTasks", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function writeTerminalTask(
    state: "done" | "dropped",
    id: string,
    updatedAt: string,
  ): void {
    const dir = join(projectDir, "data", "tasks", state);
    mkdirSync(dir, { recursive: true });
    const content = `---\nid: ${id}\ntitle: Title\nstatus: ${state}\nupdated_at: ${updatedAt}\n---\n\n## Done.\n`;
    writeFileSync(join(dir, `${id}.md`), content);
  }

  it("removes old terminal tasks while Git remains the archive", () => {
    writeTerminalTask("done", "task-old", "2020-01-01");
    const result = gcTerminalTasks(projectDir, { days: 30 });
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]).toBe("task-old.md");
    expect(existsSync(join(projectDir, "data", "tasks", "done", "task-old.md"))).toBe(false);
  });

  it("does not remove tasks newer than threshold", () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    writeTerminalTask("done", "task-recent", recent);
    const result = gcTerminalTasks(projectDir, { days: 30 });
    expect(result.removed).toHaveLength(0);
    expect(existsSync(join(projectDir, "data", "tasks", "done", "task-recent.md"))).toBe(true);
  });

  it("removes old dropped tasks", () => {
    writeTerminalTask("dropped", "task-drop-old", "2020-01-01");
    const result = gcTerminalTasks(projectDir, { days: 30 });
    expect(result.removed).toHaveLength(1);
    expect(existsSync(join(projectDir, "data", "tasks", "dropped", "task-drop-old.md"))).toBe(false);
  });

  it("dry-run returns affected list without mutating files", () => {
    writeTerminalTask("done", "task-dry", "2020-01-01");
    const result = gcTerminalTasks(projectDir, { days: 30, dryRun: true });
    expect(result.removed).toHaveLength(1);
    expect(existsSync(join(projectDir, "data", "tasks", "done", "task-dry.md"))).toBe(true);
  });

  it("handles both done and dropped states", () => {
    writeTerminalTask("done", "task-done-old", "2020-01-01");
    writeTerminalTask("dropped", "task-dropped-old", "2020-02-01");
    const result = gcTerminalTasks(projectDir, { days: 30 });
    expect(result.removed).toHaveLength(2);
  });

  it("does not touch open state tasks", () => {
    writeTaskFile(projectDir, "ready", "task-ready-skip", { updated_at: "2020-01-01" });
    const result = gcTerminalTasks(projectDir, { days: 30 });
    expect(result.removed).toHaveLength(0);
    expect(existsSync(join(projectDir, "data", "tasks", "ready", "task-ready-skip.md"))).toBe(true);
  });
});
