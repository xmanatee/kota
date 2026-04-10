import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock memory module to isolate from real ~/.kota/memory.json
vi.mock("./core/memory/store.js", () => ({
  getMemoryStore: vi.fn(() => ({
    list: () => [] as any[],
    search: () => [] as any[],
  })),
}));

// Mock history module to control conversation data
vi.mock("./core/memory/history.js", () => ({
  getHistory: vi.fn(() => ({
    getMostRecent: () => null,
  })),
}));

// Mock task-store module to isolate and test failure paths
vi.mock("./core/daemon/task-store.js", () => ({
  getTaskStore: vi.fn(() => ({
    getActiveSummary: () => null,
  })),
}));

// Mock scheduler module to isolate and test failure paths
vi.mock("./core/daemon/scheduler.js", () => ({
  getScheduler: vi.fn(() => ({
    getPendingSummary: () => null,
  })),
}));

import { getScheduler } from "./core/daemon/scheduler.js";
import { getTaskStore } from "./core/daemon/task-store.js";
import { getHistory } from "./core/memory/history.js";
import { getMemoryStore } from "./core/memory/store.js";
import { buildSessionWarmup } from "./init.js";
import { detectEnvironment, detectProject, getDirectoryOverview } from "./project-detection.js";

const mocked = vi.mocked(getMemoryStore);
const mockedHistory = vi.mocked(getHistory);
const mockedTaskStore = vi.mocked(getTaskStore);
const mockedScheduler = vi.mocked(getScheduler);

describe("detectProject", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kota-init-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when no config files exist", () => {
    expect(detectProject(dir)).toBeNull();
  });

  it("detects Node.js project with name from package.json", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app" }));
    const result = detectProject(dir);
    expect(result).toContain("Node.js project");
    expect(result).toContain("my-app");
  });

  it("detects frameworks in package.json dependencies", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { react: "^18", next: "^14" },
      }),
    );
    const result = detectProject(dir)!;
    expect(result).toContain("react");
    expect(result).toContain("next");
  });

  it("detects TypeScript and test framework from devDependencies", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        devDependencies: { typescript: "^5", vitest: "^1" },
      }),
    );
    const result = detectProject(dir)!;
    expect(result).toContain("TypeScript");
    expect(result).toContain("vitest");
  });

  it("falls back gracefully on malformed package.json", () => {
    writeFileSync(join(dir, "package.json"), "not valid json{{{");
    expect(detectProject(dir)).toBe("Node.js project");
  });

  it("detects Rust project from Cargo.toml", () => {
    writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "my-crate"\nversion = "0.1.0"');
    expect(detectProject(dir)).toContain("Rust project");
    expect(detectProject(dir)).toContain("my-crate");
  });

  it("detects Go project from go.mod", () => {
    writeFileSync(join(dir, "go.mod"), "module github.com/user/repo\n\ngo 1.21");
    expect(detectProject(dir)).toContain("Go project");
    expect(detectProject(dir)).toContain("github.com/user/repo");
  });

  it("detects Python project from pyproject.toml", () => {
    writeFileSync(join(dir, "pyproject.toml"), '[project]\nname = "analyzer"');
    expect(detectProject(dir)).toContain("Python project");
    expect(detectProject(dir)).toContain("analyzer");
  });

  it("detects Python project from requirements.txt", () => {
    writeFileSync(join(dir, "requirements.txt"), "flask\nrequests\n");
    expect(detectProject(dir)).toBe("Python project");
  });

  it("detects Make-based project from Makefile", () => {
    writeFileSync(join(dir, "Makefile"), "all:\n\techo hello");
    expect(detectProject(dir)).toBe("Make-based project");
  });

  it("package.json takes priority over Makefile", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app" }));
    writeFileSync(join(dir, "Makefile"), "all:\n\techo hello");
    expect(detectProject(dir)).toContain("Node.js project");
  });

  it("includes scripts from package.json", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", test: "vitest", lint: "eslint" } }),
    );
    const result = detectProject(dir)!;
    expect(result).toContain("scripts:");
    expect(result).toContain("build");
    expect(result).toContain("test");
  });
});

describe("buildSessionWarmup", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kota-warmup-test-"));
    mocked.mockReturnValue({
      list: () => [],
      search: () => [],
    } as any);
    mockedHistory.mockReturnValue({
      getMostRecent: () => null,
    } as any);
    mockedTaskStore.mockReturnValue({
      getActiveSummary: () => null,
    } as any);
    mockedScheduler.mockReturnValue({
      getPendingSummary: () => null,
    } as any);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("always includes working directory", () => {
    const result = buildSessionWarmup(dir);
    expect(result).toContain(dir);
    expect(result).toContain("Working directory");
  });

  it("includes project type when detected", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test-proj" }));
    const result = buildSessionWarmup(dir);
    expect(result).toContain("**Project**:");
    expect(result).toContain("Node.js project");
  });

  it("includes git context when in a git repo", () => {
    execSync("git init", { cwd: dir, stdio: "pipe" });
    execSync("git commit --allow-empty -m 'init'", {
      cwd: dir,
      stdio: "pipe",
      env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@t" },
    });
    const result = buildSessionWarmup(dir);
    expect(result).toContain("**Git**:");
    expect(result).toContain("Working tree: clean");
  });

  it("shows modified files in git context", () => {
    execSync("git init", { cwd: dir, stdio: "pipe" });
    execSync("git commit --allow-empty -m 'init'", {
      cwd: dir,
      stdio: "pipe",
      env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@t" },
    });
    writeFileSync(join(dir, "new-file.txt"), "hello");
    const result = buildSessionWarmup(dir);
    expect(result).toContain("untracked");
  });

  it("shows deleted files in git context", () => {
    const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@t" };
    execSync("git init", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "to-delete.txt"), "hello");
    execSync("git add to-delete.txt", { cwd: dir, stdio: "pipe" });
    execSync("git commit -m 'add file'", { cwd: dir, stdio: "pipe", env: gitEnv });
    rmSync(join(dir, "to-delete.txt"));
    const result = buildSessionWarmup(dir);
    expect(result).toContain("1 deleted");
  });

  it("shows renamed files in git context", () => {
    const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@t" };
    execSync("git init", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "old-name.txt"), "content");
    execSync("git add old-name.txt", { cwd: dir, stdio: "pipe" });
    execSync("git commit -m 'add file'", { cwd: dir, stdio: "pipe", env: gitEnv });
    execSync("git mv old-name.txt new-name.txt", { cwd: dir, stdio: "pipe" });
    const result = buildSessionWarmup(dir);
    expect(result).toContain("1 renamed");
  });

  it("includes recalled memories when found", () => {
    mocked.mockReturnValue({
      list: () => [{ id: "abc", content: "Uses React", tags: ["framework"], created: "" }],
      search: () => [{ id: "abc", content: "Uses React", tags: ["framework"], created: "" }],
    } as any);
    const result = buildSessionWarmup(dir);
    expect(result).toContain("Recalled from memory");
    expect(result).toContain("Uses React");
  });

  it("omits memory section when no matches", () => {
    const result = buildSessionWarmup(dir);
    expect(result).not.toContain("Recalled from memory");
  });

  it("handles non-git directory gracefully", () => {
    const result = buildSessionWarmup(dir);
    expect(result).not.toContain("**Git**:");
    expect(result).toContain("Working directory");
  });

  it("includes current date with day of week", () => {
    const result = buildSessionWarmup(dir);
    expect(result).toMatch(/Date: \d{4}-\d{2}-\d{2} \((Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\)/);
  });

  it("date matches today (local time)", () => {
    const result = buildSessionWarmup(dir);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    expect(result).toContain(`Date: ${today}`);
  });

  it("includes platform info", () => {
    const result = buildSessionWarmup(dir);
    expect(result).toContain("**System**:");
    expect(result).toContain("Platform:");
  });

  it("includes directory overview when files exist", () => {
    writeFileSync(join(dir, "data.csv"), "a,b\n1,2");
    mkdirSync(join(dir, "reports"));
    const result = buildSessionWarmup(dir);
    expect(result).toContain("**Directory**:");
    expect(result).toContain("data.csv");
    expect(result).toContain("reports/");
  });

  it("shows 'just now' for very recent conversations", () => {
    const now = new Date();
    mockedHistory.mockReturnValue({
      getMostRecent: () => ({
        id: "test-1", title: "Test chat", messageCount: 5,
        updatedAt: new Date(now.getTime() - 30000).toISOString(),
        createdAt: now.toISOString(), cwd: dir, messages: [],
      }),
    } as any);
    const result = buildSessionWarmup(dir);
    expect(result).toContain("just now");
  });

  it("uses singular 'minute' for exactly 1 minute ago", () => {
    const now = new Date();
    mockedHistory.mockReturnValue({
      getMostRecent: () => ({
        id: "test-2", title: "Test chat", messageCount: 3,
        updatedAt: new Date(now.getTime() - 75000).toISOString(),
        createdAt: now.toISOString(), cwd: dir, messages: [],
      }),
    } as any);
    const result = buildSessionWarmup(dir);
    expect(result).toContain("1 minute ago");
    expect(result).not.toContain("1 minutes ago");
  });

  it("uses singular 'hour' for exactly 1 hour ago", () => {
    const now = new Date();
    mockedHistory.mockReturnValue({
      getMostRecent: () => ({
        id: "test-3", title: "Test chat", messageCount: 3,
        updatedAt: new Date(now.getTime() - 3600000).toISOString(),
        createdAt: now.toISOString(), cwd: dir, messages: [],
      }),
    } as any);
    const result = buildSessionWarmup(dir);
    expect(result).toContain("1 hour ago");
    expect(result).not.toContain("1 hours ago");
  });

  it("uses singular 'day' for exactly 1 day ago", () => {
    const now = new Date();
    mockedHistory.mockReturnValue({
      getMostRecent: () => ({
        id: "test-4", title: "Test chat", messageCount: 3,
        updatedAt: new Date(now.getTime() - 86400000).toISOString(),
        createdAt: now.toISOString(), cwd: dir, messages: [],
      }),
    } as any);
    const result = buildSessionWarmup(dir);
    expect(result).toContain("1 day ago");
    expect(result).not.toContain("1 days ago");
  });

  it("uses plural 'minutes' for multiple minutes ago", () => {
    const now = new Date();
    mockedHistory.mockReturnValue({
      getMostRecent: () => ({
        id: "test-5", title: "Test chat", messageCount: 3,
        updatedAt: new Date(now.getTime() - 5 * 60000).toISOString(),
        createdAt: now.toISOString(), cwd: dir, messages: [],
      }),
    } as any);
    const result = buildSessionWarmup(dir);
    expect(result).toContain("5 minutes ago");
  });

  it("survives getMemoryStore() throwing", () => {
    mocked.mockImplementation(() => { throw new Error("corrupt storage"); });
    const result = buildSessionWarmup(dir);
    expect(result).toContain("Working directory");
    expect(result).not.toContain("Recalled from memory");
  });

  it("survives getTaskStore() throwing", () => {
    mockedTaskStore.mockImplementation(() => { throw new Error("corrupt tasks"); });
    const result = buildSessionWarmup(dir);
    expect(result).toContain("Working directory");
    expect(result).not.toContain("Active tasks");
  });

  it("survives getScheduler() throwing", () => {
    mockedScheduler.mockImplementation(() => { throw new Error("corrupt schedules"); });
    const result = buildSessionWarmup(dir);
    expect(result).toContain("Working directory");
    expect(result).not.toContain("Scheduled reminders");
  });

  it("survives store.list() throwing inside recallMemories", () => {
    mocked.mockReturnValue({
      list: () => { throw new Error("read error"); },
      search: () => [],
    } as any);
    const result = buildSessionWarmup(dir);
    expect(result).toContain("Working directory");
    expect(result).not.toContain("Recalled from memory");
  });

  it("survives getActiveSummary() throwing inside recallTasks", () => {
    mockedTaskStore.mockReturnValue({
      getActiveSummary: () => { throw new Error("parse error"); },
    } as any);
    const result = buildSessionWarmup(dir);
    expect(result).toContain("Working directory");
    expect(result).not.toContain("Active tasks");
  });

  it("survives getPendingSummary() throwing inside recallSchedules", () => {
    mockedScheduler.mockReturnValue({
      getPendingSummary: () => { throw new Error("timer error"); },
    } as any);
    const result = buildSessionWarmup(dir);
    expect(result).toContain("Working directory");
    expect(result).not.toContain("Scheduled reminders");
  });

  it("survives all recall functions throwing simultaneously", () => {
    mocked.mockImplementation(() => { throw new Error("memory crash"); });
    mockedTaskStore.mockImplementation(() => { throw new Error("task crash"); });
    mockedScheduler.mockImplementation(() => { throw new Error("schedule crash"); });
    mockedHistory.mockImplementation(() => { throw new Error("history crash"); });
    const result = buildSessionWarmup(dir);
    expect(result).toContain("Working directory");
    expect(result).toContain("System");
  });

  it("includes task summary when getActiveSummary returns data", () => {
    mockedTaskStore.mockReturnValue({
      getActiveSummary: () => "2 in progress: 'Research', 'Write report'",
    } as any);
    const result = buildSessionWarmup(dir);
    expect(result).toContain("**Active tasks from previous session**:");
    expect(result).toContain("Research");
  });

  it("includes schedule summary when getPendingSummary returns data", () => {
    mockedScheduler.mockReturnValue({
      getPendingSummary: () => "1 overdue: 'Check email'",
    } as any);
    const result = buildSessionWarmup(dir);
    expect(result).toContain("**Scheduled reminders**:");
    expect(result).toContain("Check email");
  });
});

describe("detectEnvironment", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kota-env-test-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns null for empty directory", () => {
    expect(detectEnvironment(dir)).toBeNull();
  });

  it("detects data files", () => {
    writeFileSync(join(dir, "sales.csv"), "a,b\n1,2");
    writeFileSync(join(dir, "config.json"), "{}");
    const result = detectEnvironment(dir)!;
    expect(result).toContain("2 data files");
    expect(result).toContain("Workspace");
  });

  it("detects document files", () => {
    writeFileSync(join(dir, "report.md"), "# Report");
    writeFileSync(join(dir, "notes.txt"), "hello");
    writeFileSync(join(dir, "paper.pdf"), "fake pdf");
    const result = detectEnvironment(dir)!;
    expect(result).toContain("3 documents");
  });

  it("detects mixed environment with multiple categories", () => {
    writeFileSync(join(dir, "data.csv"), "a,b");
    writeFileSync(join(dir, "readme.md"), "hi");
    writeFileSync(join(dir, "photo.png"), "img");
    const result = detectEnvironment(dir)!;
    expect(result).toContain("data file");
    expect(result).toContain("document");
    expect(result).toContain("image");
  });

  it("uses singular form for single file per category", () => {
    writeFileSync(join(dir, "data.csv"), "a,b");
    const result = detectEnvironment(dir)!;
    expect(result).toContain("1 data file");
    expect(result).not.toContain("1 data files");
  });

  it("uses plural form for multiple files per category", () => {
    writeFileSync(join(dir, "a.png"), "img");
    writeFileSync(join(dir, "b.png"), "img");
    writeFileSync(join(dir, "c.png"), "img");
    const result = detectEnvironment(dir)!;
    expect(result).toContain("3 images");
  });

  it("returns null when only unrecognized file types", () => {
    writeFileSync(join(dir, "mystery.xyz"), "???");
    expect(detectEnvironment(dir)).toBeNull();
  });

  it("skips hidden files", () => {
    writeFileSync(join(dir, ".hidden.csv"), "a,b");
    expect(detectEnvironment(dir)).toBeNull();
  });

  it("warmup shows environment when no project detected", () => {
    writeFileSync(join(dir, "data.csv"), "a,b\n1,2");
    writeFileSync(join(dir, "notes.md"), "# Notes");
    const result = buildSessionWarmup(dir);
    expect(result).toContain("**Environment**:");
    expect(result).toContain("Workspace");
    expect(result).not.toContain("**Project**:");
  });

  it("warmup prefers project over environment when both available", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app" }));
    writeFileSync(join(dir, "data.csv"), "a,b");
    const result = buildSessionWarmup(dir);
    expect(result).toContain("**Project**:");
    expect(result).not.toContain("**Environment**:");
  });
});

describe("getDirectoryOverview", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kota-dir-test-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns null for empty directory", () => {
    expect(getDirectoryOverview(dir)).toBeNull();
  });

  it("lists files and directories", () => {
    writeFileSync(join(dir, "readme.md"), "hello");
    writeFileSync(join(dir, "data.csv"), "a,b\n1,2");
    mkdirSync(join(dir, "src"));
    const result = getDirectoryOverview(dir)!;
    expect(result).toContain("src/");
    expect(result).toContain("readme.md");
    expect(result).toContain("data.csv");
  });

  it("skips hidden entries and noise directories", () => {
    mkdirSync(join(dir, ".git"));
    mkdirSync(join(dir, "node_modules"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, ".env"), "SECRET=x");
    writeFileSync(join(dir, "index.ts"), "");
    const result = getDirectoryOverview(dir)!;
    expect(result).toContain("src/");
    expect(result).toContain("index.ts");
    expect(result).not.toContain(".git");
    expect(result).not.toContain("node_modules");
    expect(result).not.toContain(".env");
  });

  it("truncates file list beyond 15 entries", () => {
    for (let i = 0; i < 20; i++) writeFileSync(join(dir, `file${i}.txt`), "");
    const result = getDirectoryOverview(dir)!;
    expect(result).toContain("+5 more");
  });

  it("truncates directory list beyond 10 entries", () => {
    for (let i = 0; i < 13; i++) mkdirSync(join(dir, `dir${i}`));
    const result = getDirectoryOverview(dir)!;
    expect(result).toContain("+3 more");
  });

  it("returns null for non-existent directory", () => {
    expect(getDirectoryOverview("/tmp/kota-nonexistent-dir-42")).toBeNull();
  });

  it("returns null when directory has only hidden entries", () => {
    writeFileSync(join(dir, ".hidden"), "secret");
    writeFileSync(join(dir, ".config"), "data");
    expect(getDirectoryOverview(dir)).toBeNull();
  });
});
