import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEvalCommand } from "./cli.js";
import { makeFakeCtx } from "./cli-test-support.js";

describe("kota eval fixture-candidates CLI", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "candidate-cli-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("writes JSON and readable summary artifacts for a bounded run-id scan", async () => {
    const runId = "run-cli-candidate";
    const runDir = join(projectDir, ".kota/runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify(
        {
          id: runId,
          workflow: "builder",
          status: "success",
          startedAt: "2026-06-01T00:00:00.000Z",
          steps: [
            {
              id: "build",
              type: "agent",
              status: "success",
              output: {
                content: "$ pnpm test src/modules/eval-harness/fixture-candidates.test.ts",
              },
            },
          ],
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(runDir, "run-summary.json"),
      JSON.stringify(
        {
          runId,
          workflow: "builder",
          taskId: "task-cli-candidate",
          taskTitle: "CLI candidate",
          outcome: "success",
          commitSha: "abc123",
          commitMessage: "Candidate",
          filesChanged: ["src/modules/eval-harness/fixture-candidates.ts"],
          completedAt: "2026-06-01T00:01:00.000Z",
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(runDir, "verification.json"),
      JSON.stringify({ ok: true, score: 1 }, null, 2),
    );
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      writes.push(String(data));
      return true;
    });

    const cmd = buildEvalCommand(makeFakeCtx(projectDir));
    await cmd.parseAsync(
      [
        "fixture-candidates",
        "--run-id",
        runId,
        "--output-dir",
        ".kota/runs/candidate-output",
      ],
      { from: "user" },
    );

    const reportPath = join(
      projectDir,
      ".kota/runs/candidate-output/fixture-candidates.json",
    );
    const summaryPath = join(
      projectDir,
      ".kota/runs/candidate-output/fixture-candidates.md",
    );
    const report = JSON.parse(readFileSync(reportPath, "utf-8")) as {
      candidates: Array<{ runId: string; status: string }>;
    };
    expect(report.candidates[0]).toMatchObject({
      runId,
      status: "viable",
    });
    expect(readFileSync(summaryPath, "utf-8")).toContain("Viable: 1");
    expect(writes.join("\n")).toContain("fixture candidates:");
  });
});
