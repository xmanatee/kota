import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mineFixtureCandidates } from "./fixture-candidates.js";

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function seedRun(
  projectDir: string,
  runId: string,
  options: {
    status?: string;
    commands?: readonly string[];
    filesChanged?: readonly string[];
    artifacts?: Record<string, unknown>;
    textArtifact?: string;
    steps?: readonly unknown[];
  },
): void {
  const runDir = join(projectDir, ".kota/runs", runId);
  const commands = options.commands ?? [];
  writeJson(join(runDir, "metadata.json"), {
    id: runId,
    workflow: "builder",
    startedAt: "2026-06-01T00:00:00.000Z",
    status: options.status ?? "success",
    runDir: `.kota/runs/${runId}`,
    trigger: { event: "autonomy.queue.available", payload: {} },
    steps: options.steps ?? [
      {
        id: "build",
        type: "agent",
        status: options.status ?? "success",
        output: { content: commands.map((command) => `$ ${command}`).join("\n") },
      },
      { id: "verify", type: "code", status: "success", output: { command: commands[0] } },
    ],
  });
  writeJson(join(runDir, "run-summary.json"), {
    runId,
    workflow: "builder",
    taskId: `task-${runId}`,
    filesChanged: options.filesChanged ?? ["src/modules/eval-harness/candidate.ts"],
  });
  writeJson(join(runDir, "evaluator-calibration.json"), {
    runId,
    workflow: "builder",
    taskId: `task-${runId}`,
    taskFinalState: "done",
    sourceFilesChanged: options.filesChanged ?? ["src/modules/eval-harness/candidate.ts"],
  });
  for (const [name, value] of Object.entries(options.artifacts ?? {})) {
    writeJson(join(runDir, name), value);
  }
  if (options.textArtifact !== undefined) {
    writeText(join(runDir, "transcript.txt"), options.textArtifact);
  }
}

describe("fixture candidate proposals", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "fixture-candidate-proposals-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("marks candidates duplicate when an existing task references the run evidence", () => {
    seedRun(projectDir, "run-task-duplicate", {
      commands: ["pnpm test src/modules/eval-harness/fixture-candidates.test.ts"],
      artifacts: { "verification.json": { ok: true } },
    });
    writeText(
      join(projectDir, "data/tasks/done/task-existing-eval-candidate.md"),
      [
        "---",
        "id: task-existing-eval-candidate",
        "title: Existing eval candidate",
        "status: done",
        "priority: p2",
        "area: modules",
        "created_at: 2026-06-01T00:00:00.000Z",
        "updated_at: 2026-06-01T00:00:00.000Z",
        "---",
        "",
        "## Problem",
        "",
        ".kota/runs/run-task-duplicate/metadata.json",
      ].join("\n"),
    );

    const result = mineFixtureCandidates(projectDir, {
      runIds: ["run-task-duplicate"],
      outputDir: "out",
    });

    const candidate = result.report.candidates[0];
    expect(candidate.disposition).toBe("duplicate");
    expect(candidate.reasonCodes).toContain("duplicate-existing-task");
    expect(candidate.duplicateCoverage.taskIds).toEqual(["task-existing-eval-candidate"]);
  });

  it("redacts secret-like command values and rejects destructive traces", () => {
    seedRun(projectDir, "run-secret", {
      commands: [
        "API_TOKEN=secret-value pnpm test src/modules/eval-harness/fixture-candidates.test.ts",
        "rm -rf .kota/tmp",
      ],
    });

    const result = mineFixtureCandidates(projectDir, {
      runIds: ["run-secret"],
      outputDir: "out",
    });

    const candidate = result.report.candidates[0];
    expect(candidate.disposition).toBe("rejected");
    expect(candidate.reasonCodes).toContain("privacy-secret-like-value");
    expect(candidate.reasonCodes).toContain("safety-destructive-command");
    expect(JSON.stringify(candidate)).not.toContain("secret-value");
    const redactedCommand = candidate.terminalEvidence.commands.find((command) =>
      command.command.includes("API_TOKEN="),
    );
    expect(redactedCommand?.command).toContain("API_TOKEN=[REDACTED]");
  });

  it("marks operator-captured visual evidence as needs-owner-evidence", () => {
    seedRun(projectDir, "run-operator-capture", {
      commands: ["pnpm test src/modules/eval-harness/fixture-candidates.test.ts"],
      artifacts: { "verification.json": { ok: true } },
      textArtifact: "Acceptance requires a screenshot of the actual conversation.",
    });

    const result = mineFixtureCandidates(projectDir, {
      runIds: ["run-operator-capture"],
      outputDir: "out",
    });

    const candidate = result.report.candidates[0];
    expect(candidate.disposition).toBe("needs-owner-evidence");
    expect(candidate.reasonCodes).toContain("operator-capture-required");
  });

  it("detects trace-derived proposal patterns from autonomy run artifacts", () => {
    seedRun(projectDir, "run-trajectory-a", { commands: ["pnpm test fixture-candidates"] });
    seedRun(projectDir, "run-trajectory-b", { commands: ["pnpm test fixture-candidates"] });
    for (const runId of ["run-trajectory-a", "run-trajectory-b"]) {
      writeJson(join(projectDir, ".kota/runs", runId, "steps/build.trajectory-diagnostics.json"), {
        version: 1,
        status: "supported",
        emitsAgentMessageStream: true,
        counts: { warningCount: 1 },
        diagnostics: [{
          code: "missing_final_verification_after_edit",
          severity: "warning",
          summary: "Edited after verification without rerunning checks.",
          frameIndexes: [3],
          details: ["edit after verification"],
        }],
      });
    }
    seedRun(projectDir, "run-review", {
      commands: ["pnpm test fixture-candidates"],
      artifacts: {
        "review-scrutiny.json": {
          thinAcceptances: 1,
          thinAcceptanceRefs: [{ runId: "run-review", workflow: "builder", surface: "critic" }],
        },
      },
    });
    seedRun(projectDir, "run-repair", {
      status: "failed",
      steps: [{
        id: "test",
        type: "code",
        status: "failed",
        output: { repairIterations: [{ failures: [{ id: "test" }] }] },
      }],
      textArtifact: "Validation failed after repair-loop exhaustion.",
    });
    seedRun(projectDir, "run-validation", {
      status: "failed",
      steps: [{
        id: "load",
        type: "code",
        status: "failed",
        error: "WorkflowDefinitionError: workflow schema validation failed.",
      }],
    });

    const result = mineFixtureCandidates(projectDir, {
      runIds: [
        "run-trajectory-a",
        "run-trajectory-b",
        "run-review",
        "run-repair",
        "run-validation",
      ],
      outputDir: "out",
    });

    const byRun = new Map(result.report.candidates.map((candidate) => [candidate.runId, candidate]));
    expect(byRun.get("run-trajectory-a")?.failurePattern).toMatchObject({
      kind: "recurring-trajectory-warning",
      occurrenceCount: 2,
    });
    expect(byRun.get("run-review")?.failurePattern.kind).toBe("review-scrutiny-thin-acceptance");
    expect(byRun.get("run-repair")?.failurePattern.kind).toBe("repair-loop-failure");
    expect(byRun.get("run-validation")?.failurePattern.kind).toBe("workflow-schema-validation-failure");
  });

  it("creates a normalized backlog task for accepted proposed candidates", () => {
    seedRun(projectDir, "run-accepted", {
      commands: ["pnpm test src/modules/eval-harness/fixture-candidates.test.ts"],
      filesChanged: ["src/modules/eval-harness/fixture-candidates.ts"],
      artifacts: { "verification.json": { ok: true } },
    });

    const result = mineFixtureCandidates(projectDir, {
      runIds: ["run-accepted"],
      outputDir: "out",
      createTask: true,
      nowIso: "2026-06-01T00:00:00.000Z",
    });

    const candidate = result.report.candidates[0];
    expect(candidate.disposition).toBe("accepted");
    expect(candidate.acceptedAction).toMatchObject({ kind: "task", state: "backlog" });
    const task = readFileSync(join(projectDir, candidate.acceptedAction?.path ?? ""), "utf-8");
    expect(task).toContain("status: backlog");
    expect(task).toContain(".kota/runs/run-accepted/metadata.json");
    expect(task).toContain(`<!-- fixture-candidate-fingerprint: ${candidate.proposalFingerprint} -->`);
  });
});
