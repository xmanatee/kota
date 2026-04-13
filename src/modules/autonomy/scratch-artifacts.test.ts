import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkNoScratchArtifacts } from "./shared.js";

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -m "init"', { cwd: dir });
}

describe("checkNoScratchArtifacts", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = join(tmpdir(), `scratch-artifacts-test-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
    initGitRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("passes when no scratch artifacts are staged", () => {
    writeFileSync(join(repoDir, "src.ts"), "export const x = 1;\n");
    execSync("git add src.ts", { cwd: repoDir });
    expect(checkNoScratchArtifacts(repoDir)).toContain("OK");
  });

  it("fails when .claude/worktrees/ files are staged", () => {
    mkdirSync(join(repoDir, ".claude", "worktrees"), { recursive: true });
    writeFileSync(join(repoDir, ".claude", "worktrees", "scratch"), "tmp\n");
    execSync("git add .claude/worktrees/scratch", { cwd: repoDir });
    expect(() => checkNoScratchArtifacts(repoDir)).toThrow("scratch artifacts");
  });

  it("passes with nothing staged", () => {
    expect(checkNoScratchArtifacts(repoDir)).toContain("OK");
  });
});
