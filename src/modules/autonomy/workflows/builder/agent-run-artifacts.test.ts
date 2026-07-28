import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkAgentRunArtifactsReady,
  commitBuilderWorkflowChanges,
} from "./agent-run-artifacts.js";

const tempDirs: string[] = [];

function initRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "kota-agent-run-artifacts-"));
  tempDirs.push(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "test"], { cwd: repo });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repo });
  writeFileSync(join(repo, ".gitignore"), "/.kota/runs/*\n", "utf8");
  writeFileSync(join(repo, "seed.txt"), "seed\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: repo });
  return repo;
}

function writeRequiredArtifacts(agentRunDir: string): void {
  mkdirSync(agentRunDir, { recursive: true });
  writeFileSync(join(agentRunDir, "success-criteria.txt"), "1. First\n2. Second\n", "utf8");
  writeFileSync(
    join(agentRunDir, "success-criteria-verified.txt"),
    "1. First verified\n2. Second verified\n",
    "utf8",
  );
  writeFileSync(join(agentRunDir, "commit-message.txt"), "Builder: test\n", "utf8");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("builder agent run artifacts", () => {
  it("commits ignored run evidence without changing ignore rules", () => {
    const repo = initRepo();
    const agentRunDir = join(repo, ".kota", "runs", "run-1");
    writeRequiredArtifacts(agentRunDir);
    writeFileSync(join(repo, "change.txt"), "implementation\n", "utf8");

    expect(checkAgentRunArtifactsReady(agentRunDir, repo)).toBe(
      "OK: 3 builder run evidence file(s) ready",
    );
    expect(commitBuilderWorkflowChanges(repo, agentRunDir)).toMatchObject({
      committed: true,
      message: "Builder: test",
    });

    const committed = execFileSync(
      "git",
      ["show", "--name-only", "--format=", "HEAD"],
      { cwd: repo, encoding: "utf8" },
    );
    expect(committed).toContain(".kota/runs/run-1/success-criteria.txt");
    expect(committed).toContain("change.txt");
    expect(execFileSync("git", ["show", "HEAD:.gitignore"], { cwd: repo, encoding: "utf8" }))
      .toBe("/.kota/runs/*\n");
  });

  it("rejects non-file entries in the dedicated evidence directory", () => {
    const repo = initRepo();
    const agentRunDir = join(repo, ".kota", "runs", "run-1");
    writeRequiredArtifacts(agentRunDir);
    symlinkSync(join(repo, "seed.txt"), join(agentRunDir, "linked-evidence.txt"));

    expect(() => checkAgentRunArtifactsReady(agentRunDir, repo)).toThrow(
      /must be a regular file or directory/,
    );
  });
});
