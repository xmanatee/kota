import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkAgentRunArtifactsStageable } from "./agent-run-artifacts.js";

const tempDirs: string[] = [];

function initRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "kota-agent-run-artifacts-"));
  tempDirs.push(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "test"], { cwd: repo });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repo });
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
  it("requires protocol artifacts to be stageable from the active workspace", () => {
    const repo = initRepo();
    const agentRunDir = join(repo, ".kota", "runs", "run-1");
    writeRequiredArtifacts(agentRunDir);
    writeFileSync(join(repo, ".gitignore"), "/.kota/runs/*\n", "utf8");

    expect(() => checkAgentRunArtifactsStageable(agentRunDir, repo)).toThrow(
      /Required agent run artifact is not stageable/,
    );

    writeFileSync(
      join(repo, ".gitignore"),
      [
        "!/.kota/runs/",
        "/.kota/runs/*",
        "!/.kota/runs/run-1/",
        "!/.kota/runs/run-1/*",
        "",
      ].join("\n"),
      "utf8",
    );

    expect(checkAgentRunArtifactsStageable(agentRunDir, repo)).toBe(
      "OK: 3 agent run artifact(s) stageable",
    );
  });

  it("accepts required artifacts that are already staged and clean", () => {
    const repo = initRepo();
    const agentRunDir = join(repo, ".kota", "runs", "run-1");
    writeRequiredArtifacts(agentRunDir);
    execFileSync("git", ["add", "-A", "--", ".kota/runs/run-1"], {
      cwd: repo,
    });

    expect(checkAgentRunArtifactsStageable(agentRunDir, repo)).toBe(
      "OK: 3 agent run artifact(s) stageable",
    );
  });
});
