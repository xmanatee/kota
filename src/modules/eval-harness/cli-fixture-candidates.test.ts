import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeWriterIntegrationFixture } from "#core/workflow/testing/writer-integration-fixture.js";
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
    writeWriterIntegrationFixture(join(projectDir, ".kota/runs"), {
      runId,
      changedPaths: ["src/modules/eval-harness/fixture-candidates.ts"],
      publishedHead: "abc123",
      commitSubject: "Candidate",
      commitMessage: "Candidate",
      completedAt: "2026-06-01T00:01:00.000Z",
    });
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
      candidates: Array<{ runId: string; status: string; disposition: string }>;
    };
    expect(report.candidates[0]).toMatchObject({
      runId,
      status: "viable",
      disposition: "proposed",
    });
    expect(readFileSync(summaryPath, "utf-8")).toContain("Viable: 1");
    expect(writes.join("\n")).toContain("fixture candidates:");
  });

  it("creates accepted backlog tasks when requested", async () => {
    const runId = "run-cli-accepted-candidate";
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
    writeWriterIntegrationFixture(join(projectDir, ".kota/runs"), {
      runId,
      changedPaths: ["src/modules/eval-harness/fixture-candidates.ts"],
    });
    writeFileSync(
      join(runDir, "verification.json"),
      JSON.stringify({ ok: true }, null, 2),
    );

    const cmd = buildEvalCommand(makeFakeCtx(projectDir));
    await cmd.parseAsync(
      [
        "fixture-candidates",
        "--run-id",
        runId,
        "--output-dir",
        ".kota/runs/candidate-output",
        "--create-task",
      ],
      { from: "user" },
    );

    const report = JSON.parse(
      readFileSync(
        join(projectDir, ".kota/runs/candidate-output/fixture-candidates.json"),
        "utf-8",
      ),
    ) as {
      candidates: Array<{ disposition: string; acceptedAction: { path: string } | null }>;
    };
    expect(report.candidates[0]?.disposition).toBe("accepted");
    const acceptedPath = report.candidates[0]?.acceptedAction?.path;
    expect(acceptedPath).toMatch(/^data\/tasks\/backlog\/task-eval-candidate-/);
    expect(readFileSync(join(projectDir, acceptedPath ?? ""), "utf-8")).toContain(runId);
  });
});
