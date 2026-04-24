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

function seedSourceRun(
  projectDir: string,
  runId: string,
  workflowName: string,
  stepId: string,
  stepArtifact: unknown,
  events: string[],
): void {
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
}

describe("extractAgentStepRecording", () => {
  let projectDir: string;
  let fixtureDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-recorder-project-"));
    fixtureDir = mkdtempSync(join(tmpdir(), "kota-recorder-fixture-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("extracts the response envelope and Write tool calls", () => {
    const runId = "2026-04-18T15-45-49-339Z-decomposer-zloyo6";
    const runDirAbs = join(projectDir, ".kota", "runs", runId);

    seedSourceRun(
      projectDir,
      runId,
      "decomposer",
      "decompose",
      {
        id: "decompose",
        type: "agent",
        output: {
          content: "final",
          subtype: "success",
          turns: 5,
          totalCostUsd: 0.25,
          inputTokens: 42,
          outputTokens: 77,
          sessionId: "sess-1",
        },
      },
      [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Write",
                input: {
                  file_path: join(projectDir, "data/tasks/ready/task-a.md"),
                  content: "task a",
                },
              },
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
                name: "Bash",
                input: { command: "git status" },
              },
            ],
          },
        }),
      ],
    );

    const result = extractAgentStepRecording({
      projectDir,
      sourceRunId: runId,
      stepId: "decompose",
      fixtureDir,
    });

    expect(result.recording.response).toEqual({
      text: "final",
      subtype: "success",
      turns: 5,
      totalCostUsd: 0.25,
      inputTokens: 42,
      outputTokens: 77,
      sessionId: "sess-1",
    });
    expect(result.recording.sourceRunId).toBe(runId);
    expect(result.recording.workflowName).toBe("decomposer");

    // Verify the extracted file operations:
    //  - ready/task-a.md keeps its project-relative path
    //  - commit-message.txt is rewritten with {{runDir}} placeholder
    //  - the Bash call is not captured (recorder only handles Write)
    expect(result.recording.fileOperations).toHaveLength(2);
    const taskOp = result.recording.fileOperations.find(
      (o) => o.path === "data/tasks/ready/task-a.md",
    );
    expect(taskOp).toBeDefined();
    expect(taskOp).toMatchObject({ op: "write", content: "task a" });

    const commitMsgOp = result.recording.fileOperations.find((o) =>
      o.path.startsWith("{{runDir}}/"),
    );
    expect(commitMsgOp).toBeDefined();
    expect(commitMsgOp?.path).toBe("{{runDir}}/commit-message.txt");

    // And the file was written to disk at the expected location.
    const written = JSON.parse(
      readFileSync(result.recordingPath, "utf-8"),
    ) as { sourceRunId: string };
    expect(written.sourceRunId).toBe(runId);
  });

  it("flags Write tool calls that target paths outside the project", () => {
    const runId = "2026-04-24T00-00-00-000Z-decomposer-out";
    seedSourceRun(
      projectDir,
      runId,
      "decomposer",
      "decompose",
      {
        id: "decompose",
        type: "agent",
        output: {
          content: "ok",
          subtype: "success",
          turns: 1,
          totalCostUsd: 0,
          inputTokens: 1,
          outputTokens: 1,
        },
      },
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

    const result = extractAgentStepRecording({
      projectDir,
      sourceRunId: runId,
      stepId: "decompose",
      fixtureDir,
    });
    expect(result.recording.fileOperations).toHaveLength(0);
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
