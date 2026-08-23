import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectAgentRunArtifactsForValidation } from "./agent-run-artifacts.js";
import { findPreservedBuilderEvidenceRunId } from "./preserved-evidence.js";

const tempDirs: string[] = [];

function initRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "kota-preserved-evidence-"));
  tempDirs.push(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "test"], { cwd: repo });
  writeFileSync(join(repo, ".gitignore"), "/.kota/*\n", "utf8");
  execFileSync("git", ["add", ".gitignore"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: repo });
  return repo;
}

function writeEvidence(repo: string, runId: string): void {
  const source = join(repo, ".kota", "builder-evidence", runId);
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "success-criteria.txt"), "1. Complete the task\n", "utf8");
  writeFileSync(
    join(source, "success-criteria-verified.txt"),
    "1. Verified task completion\n",
    "utf8",
  );
  writeFileSync(join(source, "commit-message.txt"), "Complete preserved work\n", "utf8");
  writeFileSync(
    join(source, "evidence-manifest.json"),
    '{"schemaVersion":1,"artifacts":[]}\n',
    "utf8",
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("preserved builder evidence", () => {
  it("reuses the single screened evidence lineage staged with preserved work", () => {
    const repo = initRepo();
    writeEvidence(repo, "builder-original");
    projectAgentRunArtifactsForValidation(
      join(repo, ".kota", "builder-evidence", "builder-original"),
      repo,
    );

    expect(findPreservedBuilderEvidenceRunId(repo, "builder-original")).toBe(
      "builder-original",
    );
  });

  it("ignores canonical evidence staged by reconciliation", () => {
    const repo = initRepo();
    writeEvidence(repo, "builder-original");
    writeEvidence(repo, "canonical-builder-one");
    writeEvidence(repo, "canonical-builder-two");
    projectAgentRunArtifactsForValidation(
      join(repo, ".kota", "builder-evidence", "canonical-builder-one"),
      repo,
    );
    projectAgentRunArtifactsForValidation(
      join(repo, ".kota", "builder-evidence", "canonical-builder-two"),
      repo,
    );

    expect(findPreservedBuilderEvidenceRunId(repo, "builder-original")).toBe(
      "builder-original",
    );
  });
});
