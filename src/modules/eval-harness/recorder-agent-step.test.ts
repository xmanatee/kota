import { execSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

describe("extractAgentStepRecording", () => {
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

  it("round-trips adds, modifies, renames, deletes, and run-dir writes", () => {
    const runId = "2026-04-24T00-00-00-000Z-decomposer-committing";
    const runDirAbs = join(projectDir, ".kota", "runs", runId);

    // Seed initial tracked state so the post-commit git operations produce a
    // realistic diff with a rename, add, modify, and delete.
    const renameBody =
      "A fairly long body so the commit-diff rename detector recognizes the " +
      "move as a rename even when one line changes at the end. ".repeat(10);
    writeFile(projectDir, "data/tasks/ready/task-a.md", `${renameBody}v1\n`);
    writeFile(projectDir, "docs/note.md", "before\n");
    writeFile(projectDir, "to-delete.md", "gone\n");
    execSync("git add -A", { cwd: projectDir });
    execSync('git commit -q -m "pre"', { cwd: projectDir });

    mkdirSync(join(projectDir, "data/tasks/done"), { recursive: true });
    execSync("git mv data/tasks/ready/task-a.md data/tasks/done/task-a.md", {
      cwd: projectDir,
    });
    writeFile(projectDir, "data/tasks/done/task-a.md", `${renameBody}v2\n`);
    writeFile(projectDir, "docs/note.md", "after\n");
    writeFile(projectDir, "src/newfile.ts", "export const x = 1;\n");
    execSync("git rm to-delete.md", { cwd: projectDir });
    execSync("git add -A", { cwd: projectDir });
    execSync('git commit -q -m "decomposer commit"', { cwd: projectDir });
    const sha = execSync("git rev-parse HEAD", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();

    seedSourceRun(
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
                  file_path: join(runDirAbs, "commit-message.txt"),
                  content: "commit msg",
                },
              },
              {
                type: "tool_use",
                name: "Write",
                input: {
                  file_path: join(runDirAbs, "notes.md"),
                  content: "run notes",
                },
              },
              {
                type: "tool_use",
                name: "Write",
                input: {
                  file_path: join(projectDir, "docs/note.md"),
                  content: "intermediate write",
                },
              },
              {
                type: "tool_use",
                name: "Bash",
                input: { command: "git status" },
              },
            ],
          },
        }),
      ],
    );
    seedWriterIntegration(projectDir, runId, {
      publishedHead: sha,
      message: "decomposer commit",
    });

    const result = extractAgentStepRecording({
      projectDir,
      sourceRunId: runId,
      stepId: "decompose",
      fixtureDir,
    });

    expect(result.sourceCommitSha).toBe(sha);
    const byPath = new Map(
      result.recording.fileOperations.map((op) => [op.path, op]),
    );
    expect(byPath.get("data/tasks/ready/task-a.md")).toEqual({
      op: "delete",
      path: "data/tasks/ready/task-a.md",
    });
    expect(byPath.get("data/tasks/done/task-a.md")).toEqual({
      op: "write",
      path: "data/tasks/done/task-a.md",
      content: `${renameBody}v2\n`,
    });
    expect(byPath.get("docs/note.md")).toEqual({
      op: "write",
      path: "docs/note.md",
      content: "after\n",
    });
    expect(byPath.get("src/newfile.ts")).toEqual({
      op: "write",
      path: "src/newfile.ts",
      content: "export const x = 1;\n",
    });
    expect(byPath.get("to-delete.md")).toEqual({
      op: "delete",
      path: "to-delete.md",
    });
    expect(byPath.get("{{runDir}}/commit-message.txt")).toEqual({
      op: "write",
      path: "{{runDir}}/commit-message.txt",
      content: "commit msg",
    });
    expect(byPath.get("{{runDir}}/notes.md")).toEqual({
      op: "write",
      path: "{{runDir}}/notes.md",
      content: "run notes",
    });
    const written = JSON.parse(
      readFileSync(result.recordingPath, "utf-8"),
    ) as { sourceRunId: string };
    expect(written.sourceRunId).toBe(runId);
    expect(result.skippedWritesOutsideProject).toEqual([]);
  });

  it("preserves redacted step content markers and run artifacts without events", () => {
    const runId = "2026-04-24T00-00-00-000Z-builder-redacted";
    writeFile(projectDir, "research-synthesis-result.json", "{}\n");
    execSync("git add -A", { cwd: projectDir });
    execSync('git commit -q -m "builder commit"', { cwd: projectDir });
    const sha = execSync("git rev-parse HEAD", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();

    const redactedContent = {
      redacted: true,
      reason: "provider-payload",
      bytes: 211,
    };
    const runDir = seedSourceRun(
      projectDir,
      runId,
      "builder",
      "build",
      {
        id: "build",
        type: "agent",
        output: {
          ...defaultAgentStep("build").output,
          content: redactedContent,
        },
      },
      [],
    );
    rmSync(join(runDir, "steps", "build.events.jsonl"));
    seedWriterIntegration(projectDir, runId, {
      publishedHead: sha,
      message: "builder commit",
    });
    writeFileSync(join(runDir, "commit-message.txt"), "Builder: finish fixture\n");
    writeFileSync(join(runDir, "success-criteria.txt"), "1. Criterion\n2. Criterion\n");
    writeFileSync(
      join(runDir, "success-criteria-verified.txt"),
      "1. Verified\n2. Verified\n",
    );

    const result = extractAgentStepRecording({
      projectDir,
      sourceRunId: runId,
      stepId: "build",
      fixtureDir,
    });

    expect(result.recording.response.text).toBe(JSON.stringify(redactedContent));
    expect(result.recording.fileOperations).toContainEqual({
      op: "write",
      path: "research-synthesis-result.json",
      content: "{}\n",
    });
    expect(result.recording.fileOperations).toContainEqual({
      op: "write",
      path: "{{runDir}}/commit-message.txt",
      content: "Builder: finish fixture\n",
    });
    expect(result.recording.fileOperations).toContainEqual({
      op: "write",
      path: "{{runDir}}/success-criteria.txt",
      content: "1. Criterion\n2. Criterion\n",
    });
    expect(result.recording.fileOperations).toContainEqual({
      op: "write",
      path: "{{runDir}}/success-criteria-verified.txt",
      content: "1. Verified\n2. Verified\n",
    });
  });
});
