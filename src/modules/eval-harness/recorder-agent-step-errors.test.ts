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
  seedWriterIntegration,
  writeFile,
} from "./recorder.test-helpers.js";

describe("extractAgentStepRecording errors", () => {
  let workspaceRoot: string;
  let fixtureDir: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-recorder-project-"));
    fixtureDir = mkdtempSync(join(tmpdir(), "kota-recorder-fixture-"));
    initGitRepo(workspaceRoot);
    writeFileSync(join(workspaceRoot, "README.md"), "init\n");
    execSync("git add README.md", { cwd: workspaceRoot });
    execSync('git commit -q -m "init"', { cwd: workspaceRoot });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("rejects a source run without writer integration evidence", () => {
    const runId = "2026-04-24T00-00-00-000Z-decomposer-nocommit";
    seedSourceRun(
      workspaceRoot,
      runId,
      "decomposer",
      "decompose",
      defaultAgentStep("decompose"),
      [],
    );
    let err: unknown;
    try {
      extractAgentStepRecording({
        workspaceRoot,
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
    expect(message).toContain("no writer-integration.json");
  });

  it("rejects a source run with no integration evidence", () => {
    const runId = "2026-04-24T00-00-00-000Z-decomposer-nostep";
    seedSourceRun(
      workspaceRoot,
      runId,
      "decomposer",
      "decompose",
      defaultAgentStep("decompose"),
      [],
    );
    expect(() =>
      extractAgentStepRecording({
        workspaceRoot,
        sourceRunId: runId,
        stepId: "decompose",
        fixtureDir,
      }),
    ).toThrow(/no writer-integration\.json/);
  });

  it("rejects traversal-shaped source run and step ids before deriving paths", () => {
    expect(() =>
      extractAgentStepRecording({
        workspaceRoot,
        sourceRunId: "../outside-run",
        stepId: "decompose",
        fixtureDir,
      }),
    ).toThrow(/--run-id must be a safe single path component/);

    expect(() =>
      extractAgentStepRecording({
        workspaceRoot,
        sourceRunId: "2026-04-24T00-00-00-000Z-decomposer-safe",
        stepId: "../decompose",
        fixtureDir,
      }),
    ).toThrow(/--step must be a safe single path component/);
  });

  it("surfaces Write events that target paths outside the scope root", () => {
    const runId = "2026-04-24T00-00-00-000Z-decomposer-outside";
    writeFile(workspaceRoot, "inside.md", "inside v1\n");
    execSync("git add -A", { cwd: workspaceRoot });
    execSync('git commit -q -m "pre-inside"', { cwd: workspaceRoot });
    writeFile(workspaceRoot, "inside.md", "inside v2\n");
    execSync("git add -A", { cwd: workspaceRoot });
    execSync('git commit -q -m "inside"', { cwd: workspaceRoot });
    const sha = execSync("git rev-parse HEAD", {
      cwd: workspaceRoot,
      encoding: "utf-8",
    }).trim();
    seedSourceRun(
      workspaceRoot,
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
    seedWriterIntegration(workspaceRoot, runId, {
      publishedHead: sha,
      message: "inside",
    });

    const result = extractAgentStepRecording({
      workspaceRoot,
      sourceRunId: runId,
      stepId: "decompose",
      fixtureDir,
    });
    expect(result.skippedWritesOutsideWorkspace).toContain("/tmp/outside-scope.md");
  });

  it("rejects a non-agent step", () => {
    const runId = "2026-04-24T00-00-00-000Z-decomposer-nonagent";
    seedSourceRun(
      workspaceRoot,
      runId,
      "decomposer",
      "assess-failure",
      { id: "assess-failure", type: "code" },
      [],
    );
    expect(() =>
      extractAgentStepRecording({
        workspaceRoot,
        sourceRunId: runId,
        stepId: "assess-failure",
        fixtureDir,
      }),
    ).toThrow(/not an agent step/);
  });
});
