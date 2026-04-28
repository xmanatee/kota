import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryStore } from "#modules/memory/store.js";
import { createNormalizedTask } from "#modules/repo-tasks/repo-tasks-operations.js";
import {
  createInboxContributor,
  createKnowledgeContributor,
  createMemoryContributor,
  createTasksContributor,
} from "./contributors.js";

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "retract-contrib-"));
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "test"', { cwd: dir });
  mkdirSync(join(dir, "data", "tasks", "backlog"), { recursive: true });
  mkdirSync(join(dir, "data", "tasks", "dropped"), { recursive: true });
  mkdirSync(join(dir, "data", "inbox"), { recursive: true });
  return dir;
}

describe("createMemoryContributor (real MemoryStore)", () => {
  it("removes the entry on the success path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "retract-mem-"));
    const store = new MemoryStore(dir);
    const id = store.save("user prefers green tea");
    expect(store.list().some((m) => m.id === id)).toBe(true);

    const contrib = createMemoryContributor(store);
    const result = await contrib.retract({ id });

    expect(result).toEqual({
      kind: "removed",
      record: { target: "memory", recordId: id },
    });
    expect(store.list().some((m) => m.id === id)).toBe(false);
  });

  it("returns not_found when the id is unknown", async () => {
    const dir = mkdtempSync(join(tmpdir(), "retract-mem-"));
    const store = new MemoryStore(dir);
    const contrib = createMemoryContributor(store);
    const result = await contrib.retract({ id: "does-not-exist" });
    expect(result).toEqual({
      kind: "not_found",
      identifier: "does-not-exist",
    });
  });
});

describe("createKnowledgeContributor (real KnowledgeStore)", () => {
  it("removes the entry on the success path", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "retract-know-"));
    const globalDir = mkdtempSync(join(tmpdir(), "retract-know-global-"));
    const store = new KnowledgeStore(projectDir, globalDir);
    const slug = store.create({
      title: "Capture seam invariants",
      content: "Detail body.",
    });
    expect(store.read(slug)).not.toBeNull();

    const contrib = createKnowledgeContributor(store);
    const result = await contrib.retract({ slug });

    expect(result).toEqual({
      kind: "removed",
      record: { target: "knowledge", recordId: slug },
    });
    expect(store.read(slug)).toBeNull();
  });

  it("returns not_found when the slug is unknown", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "retract-know-"));
    const globalDir = mkdtempSync(join(tmpdir(), "retract-know-global-"));
    const store = new KnowledgeStore(projectDir, globalDir);
    const contrib = createKnowledgeContributor(store);
    const result = await contrib.retract({ slug: "missing" });
    expect(result).toEqual({ kind: "not_found", identifier: "missing" });
  });
});

describe("createTasksContributor (real repo-tasks state machine)", () => {
  it("moves a task from backlog into dropped via the state machine, not a raw delete", async () => {
    const projectDir = makeProjectDir();
    const created = createNormalizedTask(projectDir, {
      title: "review macOS push permissions",
      priority: "p3",
      area: "uncategorized",
      state: "backlog",
      summary: "review macOS push permissions",
    });
    if (!created.ok) throw new Error("setup: createNormalizedTask failed");
    const id = created.id;
    const backlogPath = join(
      projectDir,
      "data",
      "tasks",
      "backlog",
      `${id}.md`,
    );
    expect(existsSync(backlogPath)).toBe(true);

    const contrib = createTasksContributor(projectDir);
    const result = await contrib.retract({ id });

    expect(result.kind).toBe("removed");
    if (result.kind !== "removed") throw new Error("unreachable");
    expect(result.record.target).toBe("tasks");
    if (result.record.target !== "tasks") throw new Error("unreachable");
    expect(result.record.recordId).toBe(id);
    expect(result.record.previousPath).toBe(`data/tasks/backlog/${id}.md`);
    expect(result.record.path).toBe(`data/tasks/dropped/${id}.md`);
    expect(result.record.toState).toBe("dropped");

    const droppedPath = join(
      projectDir,
      "data",
      "tasks",
      "dropped",
      `${id}.md`,
    );
    expect(existsSync(backlogPath)).toBe(false);
    expect(existsSync(droppedPath)).toBe(true);
    const body = readFileSync(droppedPath, "utf-8");
    expect(body).toMatch(/status: dropped/);
    expect(body).not.toMatch(/status: backlog/);
  });

  it("returns not_found when the task id is not present in any state directory", async () => {
    const projectDir = makeProjectDir();
    const contrib = createTasksContributor(projectDir);
    const result = await contrib.retract({ id: "task-does-not-exist" });
    expect(result).toEqual({
      kind: "not_found",
      identifier: "task-does-not-exist",
    });
  });
});

describe("createInboxContributor (real filesystem)", () => {
  it("unlinks the inbox file on the success path", async () => {
    const projectDir = makeProjectDir();
    const filePath = join(projectDir, "data", "inbox", "note-x.md");
    const repoRelative = "data/inbox/note-x.md";
    execSync(`echo 'rough thought' > "${filePath}"`);
    expect(existsSync(filePath)).toBe(true);

    const contrib = createInboxContributor(projectDir);
    const result = await contrib.retract({ path: repoRelative });

    expect(result).toEqual({
      kind: "removed",
      record: { target: "inbox", recordId: "note-x", path: repoRelative },
    });
    expect(existsSync(filePath)).toBe(false);
  });

  it("returns not_found when the path is missing", async () => {
    const projectDir = makeProjectDir();
    const contrib = createInboxContributor(projectDir);
    const result = await contrib.retract({
      path: "data/inbox/never-existed.md",
    });
    expect(result).toEqual({
      kind: "not_found",
      identifier: "data/inbox/never-existed.md",
    });
  });

  it("refuses paths outside data/inbox/", async () => {
    const projectDir = makeProjectDir();
    const contrib = createInboxContributor(projectDir);
    await expect(
      contrib.retract({ path: "data/tasks/backlog/something.md" }),
    ).rejects.toThrow(/outside data\/inbox/);
    await expect(
      contrib.retract({ path: "../etc/passwd" }),
    ).rejects.toThrow(/outside data\/inbox/);
    await expect(
      contrib.retract({ path: "data/inbox/sub/nested.md" }),
    ).rejects.toThrow(/outside data\/inbox/);
  });
});
