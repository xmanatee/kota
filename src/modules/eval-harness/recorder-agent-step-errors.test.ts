import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractAgentStepRecording } from "./recorder.js";
import {
  defaultAgentStep,
  initGitRepo,
  seedSourceRun,
  writeCommitArtifact,
  writeFile,
} from "./recorder.test-helpers.js";

describe("extractAgentStepRecording errors", () => {
  let projectDir: string;
  let fixtureDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-recorder-project-"));
    fixtureDir = mkdtempSync(join(tmpdir(), "kota-recorder-fixture-"));
    initGitRepo(projectDir);
    writeFileSync(join(projectDir, "README.md"), "init\n");
    execSync("git add README.md", { cwd: projectDir });
    execSync('git commit -q -m "init"', { cwd: projectDir });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("rejects a non-committing source run with the run id named", () => {
    const runId = "2026-04-24T00-00-00-000Z-decomposer-nocommit";
    const runDir = seedSourceRun(
      projectDir,
      runId,
      "decomposer",
      "decompose",
      defaultAgentStep("decompose"),
      [],
    );
    writeCommitArtifact(runDir, { committed: false });

    let err: unknown;
    try {
      extractAgentStepRecording({
        projectDir,
        sourceRunId: runId,
        stepId: "decompose",
        fixtureDir,
      });
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain(runId);
    expect(message).toContain("did not commit");
  });

  it("rejects a source run with no commit.json", () => {
    const runId = "2026-04-24T00-00-00-000Z-decomposer-nostep";
    seedSourceRun(
      projectDir,
      runId,
      "decomposer",
      "decompose",
      defaultAgentStep("decompose"),
      [],
    );
    expect(() =>
      extractAgentStepRecording({
        projectDir,
        sourceRunId: runId,
        stepId: "decompose",
        fixtureDir,
      }),
    ).toThrow(/no steps\/commit\.json/);
  });

  it("surfaces Write events that target paths outside the project root", () => {
    const runId = "2026-04-24T00-00-00-000Z-decomposer-outside";
    writeFile(projectDir, "inside.md", "inside v1\n");
    execSync("git add -A", { cwd: projectDir });
    execSync('git commit -q -m "pre-inside"', { cwd: projectDir });
    writeFile(projectDir, "inside.md", "inside v2\n");
    execSync("git add -A", { cwd: projectDir });
    execSync('git commit -q -m "inside"', { cwd: projectDir });
    const sha = execSync("git rev-parse HEAD", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();
    const runDir = seedSourceRun(
      projectDir,
      runId,
      "decomposer",
      "decompose",
      defaultAgentStep("decompose"),
      [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Write",
                input: {
                  file_path: "/tmp/outside-scope.md",
                  content: "oops",
                },
              },
            ],
          },
        }),
      ],
    );
    writeCommitArtifact(runDir, { committed: true, sha, message: "inside" });

    const result = extractAgentStepRecording({
      projectDir,
      sourceRunId: runId,
      stepId: "decompose",
      fixtureDir,
    });
    expect(result.skippedWritesOutsideProject).toContain("/tmp/outside-scope.md");
  });

  it("rejects a non-agent step", () => {
    const runId = "2026-04-24T00-00-00-000Z-decomposer-nonagent";
    seedSourceRun(
      projectDir,
      runId,
      "decomposer",
      "assess-failure",
      { id: "assess-failure", type: "code" },
      [],
    );
    expect(() =>
      extractAgentStepRecording({
        projectDir,
        sourceRunId: runId,
        stepId: "assess-failure",
        fixtureDir,
      }),
    ).toThrow(/not an agent step/);
  });
});
