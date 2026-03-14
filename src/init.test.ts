import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock memory module to isolate from real ~/.kota/memory.json
vi.mock("./memory.js", () => ({
  getMemoryStore: vi.fn(() => ({
    list: () => [] as any[],
    search: () => [] as any[],
  })),
}));

import { getMemoryStore } from "./memory.js";
import { detectProject, buildSessionWarmup } from "./init.js";

const mocked = vi.mocked(getMemoryStore);

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
});
