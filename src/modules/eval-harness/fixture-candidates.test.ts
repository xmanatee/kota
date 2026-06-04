import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type FixtureCandidateReport,
  mineFixtureCandidates,
} from "./fixture-candidates.js";

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
    workflow?: string;
    status?: string;
    commands?: readonly string[];
    filesChanged?: readonly string[];
    taskId?: string | null;
    taskFinalState?: string | null;
    artifacts?: Record<string, unknown>;
    textArtifact?: string;
  },
): void {
  const runDir = join(projectDir, ".kota/runs", runId);
  const commands = options.commands ?? [];
  writeJson(join(runDir, "metadata.json"), {
    id: runId,
    workflow: options.workflow ?? "builder",
    startedAt: "2026-06-01T00:00:00.000Z",
    status: options.status ?? "success",
    runDir: `.kota/runs/${runId}`,
    trigger: { event: "autonomy.queue.available", payload: {} },
    steps: [
      {
        id: "build",
        type: "agent",
        status: options.status ?? "success",
        output: {
          content: commands.map((command) => `$ ${command}`).join("\n"),
        },
      },
      {
        id: "verify",
        type: "code",
        status: "success",
        output: {
          command: commands[0],
          exitCode: 0,
        },
      },
    ],
  });
  writeJson(join(runDir, "run-summary.json"), {
    runId,
    workflow: options.workflow ?? "builder",
    taskId: options.taskId ?? `task-${runId}`,
    taskTitle: "Candidate run",
    outcome: "success",
    commitSha: "abc123",
    commitMessage: "Candidate",
    filesChanged: options.filesChanged ?? ["src/modules/eval-harness/candidate.ts"],
    completedAt: "2026-06-01T00:01:00.000Z",
  });
  writeJson(join(runDir, "evaluator-calibration.json"), {
    runId,
    workflow: options.workflow ?? "builder",
    taskId: options.taskId ?? `task-${runId}`,
    taskFinalState: options.taskFinalState ?? "done",
    sourceFilesChanged: options.filesChanged ?? ["src/modules/eval-harness/candidate.ts"],
  });
  for (const [name, value] of Object.entries(options.artifacts ?? {})) {
    writeJson(join(runDir, name), value);
  }
  if (options.textArtifact !== undefined) {
    writeText(join(runDir, "transcript.txt"), options.textArtifact);
  }
}

function readReport(path: string): FixtureCandidateReport {
  return JSON.parse(readFileSync(path, "utf-8")) as FixtureCandidateReport;
}

describe("fixture candidate mining", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "fixture-candidates-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("classifies local verified terminal runs as viable and writes bounded report artifacts", () => {
    seedRun(projectDir, "run-viable", {
      commands: [
        "pnpm test src/modules/eval-harness/fixture-candidates.test.ts",
        "pnpm typecheck",
      ],
      filesChanged: [
        "src/modules/eval-harness/fixture-candidates.ts",
        ".kota/runs/run-viable/verification.json",
      ],
      artifacts: {
        "verification.json": { predicatePass: true, objectiveScore: 1 },
      },
    });

    const result = mineFixtureCandidates(projectDir, {
      runIds: ["run-viable"],
      outputDir: ".kota/runs/miner-output",
    });

    expect(result.report.totals).toEqual({
      scannedRuns: 1,
      viable: 1,
      needsReview: 0,
      rejected: 0,
    });
    const candidate = result.report.candidates[0];
    expect(candidate.status).toBe("viable");
    expect(candidate.terminalEvidence.verificationCommands).toContain(
      "pnpm test src/modules/eval-harness/fixture-candidates.test.ts",
    );
    expect(candidate.verifierHints.stateTargets).toContain(
      "src/modules/eval-harness/fixture-candidates.ts",
    );
    expect(readReport(result.jsonPath).candidates[0].runId).toBe("run-viable");
    expect(readFileSync(result.summaryPath, "utf-8")).toContain("Viable: 1");
  });

  it("rejects runs already covered by existing real-failure fixture provenance", () => {
    seedRun(projectDir, "run-duplicate", {
      commands: ["pnpm test src/modules/eval-harness/fixture-candidates.test.ts"],
      artifacts: { "verification.json": { ok: true } },
    });
    writeJson(
      join(projectDir, "src/modules/eval-harness/fixtures/covered/fixture.json"),
      {
        id: "covered",
        provenance: {
          kind: "real-failure",
          sourceRunId: "run-duplicate",
        },
      },
    );

    const result = mineFixtureCandidates(projectDir, {
      runIds: ["run-duplicate"],
      outputDir: "out",
    });

    const candidate = result.report.candidates[0];
    expect(candidate.status).toBe("rejected");
    expect(candidate.reasonCodes).toContain("duplicate-existing-fixture");
    expect(candidate.duplicateCoverage.fixtureIds).toEqual(["covered"]);
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
    expect(candidate.status).toBe("rejected");
    expect(candidate.reasonCodes).toContain("privacy-secret-like-value");
    expect(candidate.reasonCodes).toContain("safety-destructive-command");
    const redactedCommand = candidate.terminalEvidence.commands.find((command) =>
      command.command.includes("API_TOKEN="),
    );
    expect(redactedCommand?.command).toContain("API_TOKEN=[REDACTED]");
    expect(redactedCommand?.command).not.toContain("secret-value");
  });

  it("rejects network-bound and auth-walled command evidence", () => {
    seedRun(projectDir, "run-network", {
      commands: [
        "curl https://example.com/private-report",
        "gh auth status",
      ],
      artifacts: { "verification.json": { ok: true } },
    });

    const result = mineFixtureCandidates(projectDir, {
      runIds: ["run-network"],
      outputDir: "out",
    });

    const candidate = result.report.candidates[0];
    expect(candidate.status).toBe("rejected");
    expect(candidate.reasonCodes).toContain("reproducibility-network-bound");
    expect(candidate.reasonCodes).toContain("reproducibility-auth-walled");
    expect(candidate.reproducibility.localOnly).toBe(false);
  });

  it("rejects traces that depend on operator-captured visual evidence", () => {
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
    expect(candidate.status).toBe("rejected");
    expect(candidate.reasonCodes).toContain("operator-capture-required");
  });

  it("emits explicit malformed rejected records instead of silently skipping bad artifacts", () => {
    const runDir = join(projectDir, ".kota/runs/run-malformed");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "metadata.json"), "{ bad json");

    const result = mineFixtureCandidates(projectDir, {
      runIds: ["run-malformed"],
      outputDir: "out",
    });

    const candidate = result.report.candidates[0];
    expect(candidate.status).toBe("rejected");
    expect(candidate.reasonCodes).toEqual(["artifact-malformed"]);
    expect(candidate.reasonSummary).toContain("artifact-malformed");
  });

  it("rejects otherwise viable runs with malformed top-level JSON artifacts", () => {
    seedRun(projectDir, "run-malformed-verification", {
      commands: ["pnpm test src/modules/eval-harness/fixture-candidates.test.ts"],
      filesChanged: ["src/modules/eval-harness/fixture-candidates.ts"],
      artifacts: { "verification.json": { ok: true } },
    });
    writeText(
      join(projectDir, ".kota/runs/run-malformed-verification/verification.json"),
      "{ bad json",
    );

    const result = mineFixtureCandidates(projectDir, {
      runIds: ["run-malformed-verification"],
      outputDir: "out",
    });

    const candidate = result.report.candidates[0];
    expect(candidate.status).toBe("rejected");
    expect(candidate.reasonCodes).toContain("artifact-malformed");
    expect(candidate.structuredArtifacts).toContainEqual({
      path: "verification.json",
      kind: "json",
      signal: "malformed json",
    });
  });

  it("rejects otherwise viable runs with malformed internal step artifacts", () => {
    seedRun(projectDir, "run-malformed-step", {
      commands: ["pnpm test src/modules/eval-harness/fixture-candidates.test.ts"],
      filesChanged: ["src/modules/eval-harness/fixture-candidates.ts"],
      artifacts: { "verification.json": { ok: true } },
    });
    writeText(
      join(projectDir, ".kota/runs/run-malformed-step/steps/build.json"),
      "{ bad json",
    );

    const result = mineFixtureCandidates(projectDir, {
      runIds: ["run-malformed-step"],
      outputDir: "out",
    });

    const candidate = result.report.candidates[0];
    expect(candidate.status).toBe("rejected");
    expect(candidate.reasonCodes).toContain("artifact-malformed");
    expect(candidate.structuredArtifacts).toContainEqual({
      path: "steps/build.json",
      kind: "json",
      signal: "malformed json",
    });
    expect(candidate.terminalEvidence.commands.map((command) => command.command)).not.toContain(
      "malformed step artifact",
    );
  });

  it("rejects sparse runs without verifier signal", () => {
    seedRun(projectDir, "run-sparse", {
      commands: [],
      filesChanged: [],
      artifacts: {},
    });

    const result = mineFixtureCandidates(projectDir, {
      runIds: ["run-sparse"],
      outputDir: "out",
    });

    const candidate = result.report.candidates[0];
    expect(candidate.status).toBe("rejected");
    expect(candidate.reasonCodes).toContain("trace-too-sparse");
    expect(candidate.reasonCodes).toContain("verifier-no-state-signal");
  });
});
