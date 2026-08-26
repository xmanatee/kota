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

  it("round-trips adds, modifies, renames, deletes, and run-dir writes", () => {
    const runId = "2026-04-24T00-00-00-000Z-decomposer-committing";
    const runDirAbs = join(workspaceRoot, ".kota", "runs", runId);

    // Seed initial tracked state so the post-commit git operations produce a
    // realistic diff with a rename, add, modify, and delete.
    const renameBody =
      "A fairly long body so the commit-diff rename detector recognizes the " +
      "move as a rename even when one line changes at the end. ".repeat(10);
    writeFile(workspaceRoot, "data/tasks/ready/task-a.md", `${renameBody}v1\n`);
    writeFile(workspaceRoot, "docs/note.md", "before\n");
    writeFile(workspaceRoot, "to-delete.md", "gone\n");
    execSync("git add -A", { cwd: workspaceRoot });
    execSync('git commit -q -m "pre"', { cwd: workspaceRoot });

    mkdirSync(join(workspaceRoot, "data/tasks/done"), { recursive: true });
    execSync("git mv data/tasks/ready/task-a.md data/tasks/done/task-a.md", {
      cwd: workspaceRoot,
    });
    writeFile(workspaceRoot, "data/tasks/done/task-a.md", `${renameBody}v2\n`);
    writeFile(workspaceRoot, "docs/note.md", "after\n");
    writeFile(workspaceRoot, "src/newfile.ts", "export const x = 1;\n");
    execSync("git rm to-delete.md", { cwd: workspaceRoot });
    execSync("git add -A", { cwd: workspaceRoot });
    execSync('git commit -q -m "decomposer commit"', { cwd: workspaceRoot });
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
                  file_path: join(workspaceRoot, "docs/note.md"),
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
    seedWriterIntegration(workspaceRoot, runId, {
      publishedHead: sha,
      message: "decomposer commit",
    });

    const result = extractAgentStepRecording({
      workspaceRoot,
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
    expect(result.skippedWritesOutsideWorkspace).toEqual([]);
  });

  it("preserves redacted step content markers and run artifacts without events", () => {
    const runId = "2026-04-24T00-00-00-000Z-builder-redacted";
    writeFile(workspaceRoot, "research-synthesis-result.json", "{}\n");
    execSync("git add -A", { cwd: workspaceRoot });
    execSync('git commit -q -m "builder commit"', { cwd: workspaceRoot });
    const sha = execSync("git rev-parse HEAD", {
      cwd: workspaceRoot,
      encoding: "utf-8",
    }).trim();

	const redactedContent = {
      redacted: true,
      reason: "provider-payload",
      bytes: 211,
	};
	const defaultStep = defaultAgentStep("build");
	const runDir = seedSourceRun(
      workspaceRoot,
      runId,
      "builder",
      "build",
		{
			...defaultStep,
			output: {
				...defaultStep.output,
				content: redactedContent,
        },
      },
      [],
    );
    rmSync(join(runDir, "steps", "build.events.jsonl"));
    seedWriterIntegration(workspaceRoot, runId, {
      publishedHead: sha,
      message: "builder commit",
    });
    writeFileSync(join(runDir, "commit-message.txt"), "Builder: finish fixture\n");

    const result = extractAgentStepRecording({
      workspaceRoot,
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
  });
});
