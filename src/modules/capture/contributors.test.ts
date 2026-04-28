import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  KnowledgeProvider,
  MemoryProvider,
} from "#core/modules/provider-types.js";
import {
  createInboxContributor,
  createKnowledgeContributor,
  createMemoryContributor,
  createTasksContributor,
} from "./contributors.js";

function fakeMemoryProvider(): MemoryProvider & { saved: string[] } {
  const saved: string[] = [];
  return {
    saved,
    save(content: string) {
      saved.push(content);
      return `mem-${saved.length}`;
    },
    search() {
      return [];
    },
    list() {
      return [];
    },
    update() {
      return false;
    },
    delete() {
      return false;
    },
    supportsSemanticSearch() {
      return false;
    },
    async semanticSearch() {
      return [];
    },
    async reindex() {
      return { indexed: 0, failed: 0, skipped: true };
    },
  };
}

function fakeKnowledgeProvider(): KnowledgeProvider & {
  created: { title: string; content: string }[];
} {
  const created: { title: string; content: string }[] = [];
  return {
    created,
    create(opts) {
      created.push({ title: opts.title, content: opts.content });
      return `know-${created.length}`;
    },
    read() {
      return null;
    },
    update() {
      return false;
    },
    delete() {
      return false;
    },
    search() {
      return [];
    },
    list() {
      return [];
    },
    count() {
      return 0;
    },
    supportsSemanticSearch() {
      return false;
    },
    async semanticSearch() {
      return [];
    },
    async reindex() {
      return { indexed: 0, failed: 0, skipped: true };
    },
  };
}

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "capture-contrib-"));
  // Initialize git so `git add` inside createNormalizedTask is harmless.
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "test"', { cwd: dir });
  mkdirSync(join(dir, "data", "tasks", "backlog"), { recursive: true });
  mkdirSync(join(dir, "data", "inbox"), { recursive: true });
  return dir;
}

describe("createMemoryContributor", () => {
  it("delegates to MemoryProvider.save and returns the typed memory id", async () => {
    const provider = fakeMemoryProvider();
    const contrib = createMemoryContributor(provider);
    const record = await contrib.capture({
      text: "remember dark themes preference",
    });
    expect(record).toEqual({ target: "memory", recordId: "mem-1" });
    expect(provider.saved).toEqual(["remember dark themes preference"]);
  });

  it("propagates provider throws", async () => {
    const contrib = createMemoryContributor({
      ...fakeMemoryProvider(),
      save() {
        throw new Error("memory write failed");
      },
    });
    await expect(contrib.capture({ text: "x" })).rejects.toThrow(
      /memory write failed/,
    );
  });
});

describe("createKnowledgeContributor", () => {
  it("uses the first non-empty line as title and the full text as content", async () => {
    const provider = fakeKnowledgeProvider();
    const contrib = createKnowledgeContributor(provider);
    const record = await contrib.capture({
      text: "TS unions exhaustive\nMore detail on second line.",
    });
    expect(record).toEqual({ target: "knowledge", recordId: "know-1" });
    expect(provider.created[0]).toEqual({
      title: "TS unions exhaustive",
      content: "TS unions exhaustive\nMore detail on second line.",
    });
  });

  it("throws when the first line is empty", async () => {
    const contrib = createKnowledgeContributor(fakeKnowledgeProvider());
    await expect(contrib.capture({ text: "\n\n   \n" })).rejects.toThrow(
      /non-empty first line/,
    );
  });
});

describe("createTasksContributor", () => {
  it("creates a normalized task with title from the first line", async () => {
    const projectDir = makeProjectDir();
    const contrib = createTasksContributor(projectDir);
    const record = await contrib.capture({
      text: "review macOS push permissions",
    });
    expect(record.target).toBe("tasks");
    if (record.target !== "tasks") throw new Error("unreachable");
    expect(record.recordId).toBe("task-review-macos-push-permissions");
    const filePath = join(projectDir, record.path);
    expect(existsSync(filePath)).toBe(true);
    const body = readFileSync(filePath, "utf-8");
    expect(body).toMatch(/title: review macOS push permissions/);
    expect(body).toMatch(/status: backlog/);
    expect(body).toMatch(/priority: p3/);
  });

  it("throws when the title produces an empty slug", async () => {
    const projectDir = makeProjectDir();
    const contrib = createTasksContributor(projectDir);
    await expect(contrib.capture({ text: "??? !!!" })).rejects.toThrow(
      /Task capture rejected/,
    );
  });

  it("throws when the first line is empty", async () => {
    const projectDir = makeProjectDir();
    const contrib = createTasksContributor(projectDir);
    await expect(contrib.capture({ text: "" })).rejects.toThrow(
      /non-empty first line/,
    );
  });
});

describe("createInboxContributor", () => {
  it("writes a slugged note file under data/inbox/", async () => {
    const projectDir = makeProjectDir();
    const contrib = createInboxContributor(projectDir);
    const record = await contrib.capture({
      text: "raw thought worth filing later",
    });
    expect(record.target).toBe("inbox");
    if (record.target !== "inbox") throw new Error("unreachable");
    expect(record.recordId).toBe("note-raw-thought-worth-filing-later");
    expect(record.path).toBe(
      "data/inbox/note-raw-thought-worth-filing-later.md",
    );
    const body = readFileSync(join(projectDir, record.path), "utf-8");
    expect(body.endsWith("\n")).toBe(true);
    expect(body).toContain("raw thought worth filing later");
  });

  it("throws when a note with the same slug already exists", async () => {
    const projectDir = makeProjectDir();
    const contrib = createInboxContributor(projectDir);
    await contrib.capture({ text: "duplicate-thought" });
    await expect(
      contrib.capture({ text: "duplicate-thought" }),
    ).rejects.toThrow(/already exists/);
  });

  it("throws when the title produces an empty slug", async () => {
    const projectDir = makeProjectDir();
    const contrib = createInboxContributor(projectDir);
    await expect(contrib.capture({ text: "??? !!!" })).rejects.toThrow(
      /empty slug/,
    );
  });
});
