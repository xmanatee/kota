import { execSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAgentStepRecording } from "./agent-step-recording.js";
import {
  extractAgentStepRecording,
  extractJudgeCallRecording,
} from "./recorder.js";

type AgentStepArtifact = {
  id: string;
  type: "agent" | "code";
  output?: {
    content?: string;
    subtype?: string;
    turns?: number;
    totalCostUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    sessionId?: string;
  };
};

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  execSync("git config commit.gpgsign false", { cwd: dir });
}

function writeFile(dir: string, path: string, content: string): void {
  const abs = join(dir, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function seedSourceRun(
  projectDir: string,
  runId: string,
  workflowName: string,
  stepId: string,
  stepArtifact: AgentStepArtifact,
  events: readonly string[],
): string {
  const runDir = join(projectDir, ".kota", "runs", runId);
  mkdirSync(join(runDir, "steps"), { recursive: true });
  writeFileSync(
    join(runDir, "metadata.json"),
    JSON.stringify({ id: runId, workflow: workflowName }),
  );
  writeFileSync(
    join(runDir, "steps", `${stepId}.json`),
    JSON.stringify(stepArtifact),
  );
  writeFileSync(
    join(runDir, "steps", `${stepId}.events.jsonl`),
    events.join("\n"),
  );
  return runDir;
}

function writeCommitArtifact(
  runDir: string,
  params: { committed: boolean; sha?: string; message?: string },
): void {
  const output =
    params.committed && params.sha && params.message
      ? { committed: true, sha: params.sha, message: params.message }
      : { committed: params.committed };
  writeFileSync(
    join(runDir, "steps", "commit.json"),
    JSON.stringify({
      id: "commit",
      type: "code",
      status: "success",
      output,
    }),
  );
}

function defaultAgentStep(stepId: string): AgentStepArtifact {
  return {
    id: stepId,
    type: "agent",
    output: {
      content: "ok",
      subtype: "success",
      turns: 1,
      totalCostUsd: 0,
      inputTokens: 1,
      outputTokens: 1,
    },
  };
}

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

    // Seed initial tracked state: an existing task-a in ready/ and a tracked
    // note that will be modified. Then stage the post-commit state (rename,
    // add, modify) via real git operations so `diff --find-renames` sees the
    // rename.
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
              // A direct Write tool call that happens to target a repo-tree
              // path that the commit diff also covers. The commit-diff entry
              // should win.
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
    writeCommitArtifact(join(projectDir, ".kota", "runs", runId), {
      committed: true,
      sha,
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

    // Rename expands to delete + write with post-rename content.
    expect(byPath.get("data/tasks/ready/task-a.md")).toEqual({
      op: "delete",
      path: "data/tasks/ready/task-a.md",
    });
    expect(byPath.get("data/tasks/done/task-a.md")).toEqual({
      op: "write",
      path: "data/tasks/done/task-a.md",
      content: `${renameBody}v2\n`,
    });
    // Modify: commit-diff content wins over the intermediate Write event.
    expect(byPath.get("docs/note.md")).toEqual({
      op: "write",
      path: "docs/note.md",
      content: "after\n",
    });
    // Add.
    expect(byPath.get("src/newfile.ts")).toEqual({
      op: "write",
      path: "src/newfile.ts",
      content: "export const x = 1;\n",
    });
    // Delete.
    expect(byPath.get("to-delete.md")).toEqual({
      op: "delete",
      path: "to-delete.md",
    });
    // Run-dir writes templated.
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
    // Intentionally do not write commit.json.
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

describe("extractJudgeCallRecording", () => {
  let projectDir: string;
  let fixtureDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-judge-recorder-project-"));
    fixtureDir = mkdtempSync(join(tmpdir(), "kota-judge-recorder-fixture-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  function seedJudgeArtifact(
    runId: string,
    workflowName: string,
    label: string,
    verdict: Record<string, unknown>,
  ): void {
    const runDir = join(projectDir, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({ id: runId, workflow: workflowName }),
    );
    writeFileSync(
      join(runDir, `${label}.json`),
      JSON.stringify(verdict, null, 2),
    );
  }

  it("wraps a critic-review artifact as a judge recording that round-trips through the loader", () => {
    const runId = "2026-04-24T00-00-00-000Z-builder-judge";
    const verdict = {
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "All Done When criteria addressed.",
    };
    seedJudgeArtifact(runId, "builder", "critic-review", verdict);

    const result = extractJudgeCallRecording({
      projectDir,
      sourceRunId: runId,
      label: "critic-review",
      fixtureDir,
    });

    expect(result.recording.version).toBe(1);
    expect(result.recording.workflowName).toBe("builder");
    expect(result.recording.stepId).toBe("critic-review");
    expect(result.recording.sourceRunId).toBe(runId);
    expect(result.recording.fileOperations).toEqual([]);
    expect(result.recording.response.subtype).toBe("success");
    expect(result.recording.response.turns).toBe(1);
    expect(result.recording.response.totalCostUsd).toBe(0);
    expect(result.recording.response.inputTokens).toBe(0);
    expect(result.recording.response.outputTokens).toBe(0);
    expect(JSON.parse(result.recording.response.text)).toEqual(verdict);

    // The written recording must parse cleanly through the production loader
    // — the same path the replay adapter takes — and preserve the verdict text.
    const reloaded = parseAgentStepRecording(
      readFileSync(result.recordingPath, "utf-8"),
      result.recordingPath,
    );
    expect(reloaded.stepId).toBe("critic-review");
    expect(JSON.parse(reloaded.response.text)).toEqual(verdict);
  });

  it("accepts a non-critic judge label (improver semantic gate) without hardcoding", () => {
    const runId = "2026-04-24T00-00-00-000Z-improver-gate";
    const verdict = {
      verdict: "fail",
      critical_issues: ["artifact-only diff"],
      warnings: [],
      summary: "Diff only touches scratch files.",
    };
    seedJudgeArtifact(runId, "improver", "semantic-gate-review", verdict);

    const result = extractJudgeCallRecording({
      projectDir,
      sourceRunId: runId,
      label: "semantic-gate-review",
      fixtureDir,
    });

    expect(result.recording.stepId).toBe("semantic-gate-review");
    expect(result.recording.workflowName).toBe("improver");
    expect(result.recordingPath).toBe(
      join(fixtureDir, "recordings", "semantic-gate-review.json"),
    );
    expect(JSON.parse(result.recording.response.text)).toEqual(verdict);
  });

  it("rejects a source run missing the labeled judge artifact, naming run id and label", () => {
    const runId = "2026-04-24T00-00-00-000Z-builder-nojudge";
    const runDir = join(projectDir, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({ id: runId, workflow: "builder" }),
    );
    // Intentionally do not write critic-review.json.

    let err: unknown;
    try {
      extractJudgeCallRecording({
        projectDir,
        sourceRunId: runId,
        label: "critic-review",
        fixtureDir,
      });
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain(runId);
    expect(message).toContain("critic-review");
  });

  it("rejects an unparseable judge artifact", () => {
    const runId = "2026-04-24T00-00-00-000Z-builder-badjson";
    const runDir = join(projectDir, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({ id: runId, workflow: "builder" }),
    );
    writeFileSync(join(runDir, "critic-review.json"), "{not json");

    expect(() =>
      extractJudgeCallRecording({
        projectDir,
        sourceRunId: runId,
        label: "critic-review",
        fixtureDir,
      }),
    ).toThrow(/not valid JSON/);
  });
});
