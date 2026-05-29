import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  TrajectoryDiagnosticCode,
  TrajectoryDiagnosticsArtifact,
} from "#core/agent-harness/index.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import {
  applyTrajectoryDiagnosticEscalation,
  buildTrajectoryDiagnosticAttentionDigest,
  detectRecurringTrajectoryDiagnosticPatterns,
  proposeTrajectoryDiagnosticEscalation,
} from "./trajectory-diagnostic-escalation.js";

const NOW = Date.parse("2026-05-29T12:00:00.000Z");

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "trajectory-diagnostic-escalation-"));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
  }
  mkdirSync(join(dir, ".kota", "runs"), { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  execFileSync("git", ["commit", "--allow-empty", "-m", "initial", "--quiet"], {
    cwd: dir,
  });
  return dir;
}

function countsFor(code: TrajectoryDiagnosticCode | null) {
  return {
    warningCount: code === null ? 0 : 1,
    unsupportedTrajectoryCount: code === "unsupported_trajectory" ? 1 : 0,
    missingStreamingFramesCount: code === "missing_streaming_frames" ? 1 : 0,
    missingFinalVerificationAfterEditCount:
      code === "missing_final_verification_after_edit" ? 1 : 0,
    repeatedIdenticalFailingCommandCount:
      code === "repeated_identical_failing_command" ? 1 : 0,
    editAfterSuccessfulVerificationCount:
      code === "edit_after_successful_verification" ? 1 : 0,
    longPreambleWithoutTaskTouchCount:
      code === "long_preamble_without_task_touch" ? 1 : 0,
  };
}

function artifactFor(code: TrajectoryDiagnosticCode | null): TrajectoryDiagnosticsArtifact {
  const unsupported = code === "unsupported_trajectory";
  return {
    version: 1,
    status: unsupported ? "unsupported" : "supported",
    emitsAgentMessageStream: !unsupported,
    counts: countsFor(code),
    diagnostics:
      code === null
        ? []
        : [
            {
              code,
              severity: "warning",
              summary: unsupported
                ? "Harness does not emit KOTA-native message frames, so trajectory-quality checks are unsupported."
                : "A file-editing action was not followed by a verification-like command.",
              frameIndexes: unsupported ? [] : [8],
              details: unsupported
                ? ["capability.emitsAgentMessageStream=false"]
                : ["lastEditFrame=8", "lastEditTool=apply_patch"],
            },
          ],
  };
}

function supportedArtifactWithUnsupportedDiagnostic(): TrajectoryDiagnosticsArtifact {
  return {
    ...artifactFor("unsupported_trajectory"),
    status: "supported",
    emitsAgentMessageStream: true,
  };
}

function seedTrajectoryRun(
  projectDir: string,
  opts: {
    id: string;
    hoursAgo: number;
    code: TrajectoryDiagnosticCode | null;
    artifact?: TrajectoryDiagnosticsArtifact;
    workflow?: string;
    stepId?: string;
    status?: WorkflowRunMetadata["status"];
  },
): void {
  const workflow = opts.workflow ?? "builder";
  const stepId = opts.stepId ?? "build";
  const completedAt = new Date(NOW - opts.hoursAgo * 60 * 60 * 1000).toISOString();
  const metadata: WorkflowRunMetadata = {
    id: opts.id,
    workflow,
    definitionPath: `src/modules/autonomy/workflows/${workflow}/workflow.ts`,
    trigger: { event: "workflow.completed", payload: {} },
    startedAt: new Date(NOW - opts.hoursAgo * 60 * 60 * 1000 - 1000).toISOString(),
    completedAt,
    status: opts.status ?? "success",
    durationMs: 1000,
    runDir: `.kota/runs/${opts.id}`,
    steps: [
      {
        id: stepId,
        type: "agent",
        status: "success",
        startedAt: completedAt,
        completedAt,
        durationMs: 1000,
      },
    ],
  };
  const runDir = join(projectDir, ".kota", "runs", opts.id);
  const stepsDir = join(runDir, "steps");
  mkdirSync(stepsDir, { recursive: true });
  writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  writeFileSync(
    join(stepsDir, `${stepId}.trajectory-diagnostics.json`),
    JSON.stringify(opts.artifact ?? artifactFor(opts.code), null, 2),
  );
}

function detect(projectDir: string) {
  return detectRecurringTrajectoryDiagnosticPatterns(
    join(projectDir, ".kota", "runs"),
    { nowMs: NOW },
  );
}

function readyTaskPaths(projectDir: string): string[] {
  const readyDir = join(projectDir, "data", "tasks", "ready");
  return readdirSync(readyDir)
    .filter((entry) => entry.endsWith(".md"))
    .sort()
    .map((entry) => join(readyDir, entry));
}

describe("detectRecurringTrajectoryDiagnosticPatterns", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("emits no patterns for clean no-warning trajectory artifacts", () => {
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T09-00-00-000Z-builder-clean-a",
      hoursAgo: 3,
      code: null,
    });
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T10-00-00-000Z-builder-clean-b",
      hoursAgo: 2,
      code: null,
    });
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T11-00-00-000Z-builder-clean-c",
      hoursAgo: 1,
      code: null,
    });

    expect(detect(projectDir)).toEqual([]);
  });

  it("keeps isolated advisory warnings below the escalation threshold", () => {
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T09-00-00-000Z-builder-isolated-a",
      hoursAgo: 3,
      code: "missing_final_verification_after_edit",
    });
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T10-00-00-000Z-builder-isolated-b",
      hoursAgo: 2,
      code: null,
    });
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T11-00-00-000Z-builder-isolated-c",
      hoursAgo: 1,
      code: null,
    });

    expect(detect(projectDir)).toEqual([]);
  });

  it("does not escalate repeated unsupported harness capability artifacts", () => {
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T09-00-00-000Z-builder-unsupported-a",
      hoursAgo: 3,
      code: "unsupported_trajectory",
    });
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T10-00-00-000Z-builder-unsupported-b",
      hoursAgo: 2,
      code: "unsupported_trajectory",
    });
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T11-00-00-000Z-builder-unsupported-c",
      hoursAgo: 1,
      code: "unsupported_trajectory",
    });

    expect(detect(projectDir)).toEqual([]);
  });

  it("keeps the explorer unsupported_trajectory fingerprint below the escalation gate", () => {
    for (const [index, hour] of [9, 10, 11].entries()) {
      seedTrajectoryRun(projectDir, {
        id: `2026-05-29T${String(hour).padStart(2, "0")}-00-00-000Z-explorer-unsupported-${index}`,
        hoursAgo: 3 - index,
        code: "unsupported_trajectory",
        workflow: "explorer",
        stepId: "explore",
      });
    }

    const patterns = detect(projectDir);

    expect(patterns).toEqual([]);
    expect(JSON.stringify(patterns)).not.toContain(
      "trajectory-diagnostic:explorer:explore:unsupported_trajectory",
    );
  });

  it("keeps the improver unsupported_trajectory fingerprint below the escalation gate", () => {
    for (const [index, hour] of [9, 10, 11].entries()) {
      seedTrajectoryRun(projectDir, {
        id: `2026-05-29T${String(hour).padStart(2, "0")}-00-00-000Z-improver-unsupported-${index}`,
        hoursAgo: 3 - index,
        code: "unsupported_trajectory",
        workflow: "improver",
        stepId: "improve",
      });
    }

    const patterns = detect(projectDir);

    expect(patterns).toEqual([]);
    expect(JSON.stringify(patterns)).not.toContain(
      "trajectory-diagnostic:improver:improve:unsupported_trajectory",
    );
  });

  it("does not escalate unsupported_trajectory codes from otherwise supported artifacts", () => {
    for (const [index, hour] of [9, 10, 11].entries()) {
      seedTrajectoryRun(projectDir, {
        id: `2026-05-29T${String(hour).padStart(2, "0")}-00-00-000Z-builder-supported-unsupported-${index}`,
        hoursAgo: 3 - index,
        code: "unsupported_trajectory",
        artifact: supportedArtifactWithUnsupportedDiagnostic(),
      });
    }

    expect(detect(projectDir)).toEqual([]);
  });

  it("groups repeated warnings by workflow, step, code, and detail fingerprint", () => {
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T09-00-00-000Z-builder-repeat-a",
      hoursAgo: 3,
      code: "missing_final_verification_after_edit",
    });
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T10-00-00-000Z-builder-repeat-b",
      hoursAgo: 2,
      code: "missing_final_verification_after_edit",
    });
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T11-00-00-000Z-builder-repeat-c",
      hoursAgo: 1,
      code: "missing_final_verification_after_edit",
    });

    const patterns = detect(projectDir);

    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      workflow: "builder",
      stepId: "build",
      code: "missing_final_verification_after_edit",
      runCount: 3,
      runIds: [
        "2026-05-29T09-00-00-000Z-builder-repeat-a",
        "2026-05-29T10-00-00-000Z-builder-repeat-b",
        "2026-05-29T11-00-00-000Z-builder-repeat-c",
      ],
    });
    expect(patterns[0]?.fingerprint).toContain(
      "trajectory-diagnostic:builder:build:missing_final_verification_after_edit",
    );
    expect(patterns[0]?.artifactPaths).toEqual([
      ".kota/runs/2026-05-29T09-00-00-000Z-builder-repeat-a/steps/build.trajectory-diagnostics.json",
      ".kota/runs/2026-05-29T10-00-00-000Z-builder-repeat-b/steps/build.trajectory-diagnostics.json",
      ".kota/runs/2026-05-29T11-00-00-000Z-builder-repeat-c/steps/build.trajectory-diagnostics.json",
    ]);
  });

  it("drops stale patterns after a newer clean artifact for the same workflow step", () => {
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T07-00-00-000Z-builder-stale-a",
      hoursAgo: 5,
      code: "missing_final_verification_after_edit",
    });
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T08-00-00-000Z-builder-stale-b",
      hoursAgo: 4,
      code: "missing_final_verification_after_edit",
    });
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T09-00-00-000Z-builder-stale-c",
      hoursAgo: 3,
      code: "missing_final_verification_after_edit",
    });
    seedTrajectoryRun(projectDir, {
      id: "2026-05-29T11-00-00-000Z-builder-stale-clean",
      hoursAgo: 1,
      code: null,
    });

    expect(detect(projectDir)).toEqual([]);
  });
});

describe("trajectory diagnostic escalation tasks", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("creates one valid repair task without raw prompt or full tool-output leakage", () => {
    for (const [index, hour] of [9, 10, 11].entries()) {
      seedTrajectoryRun(projectDir, {
        id: `2026-05-29T${String(hour).padStart(2, "0")}-00-00-000Z-builder-task-${index}`,
        hoursAgo: 3 - index,
        code: "missing_final_verification_after_edit",
      });
    }
    const firstRunDir = join(
      projectDir,
      ".kota",
      "runs",
      "2026-05-29T09-00-00-000Z-builder-task-0",
    );
    writeFileSync(
      join(firstRunDir, "build.events.jsonl"),
      "RAW_PROMPT_SECRET FULL_TOOL_OUTPUT_SECRET\n",
    );

    const pattern = detect(projectDir)[0]!;
    const proposal = proposeTrajectoryDiagnosticEscalation(projectDir, pattern);
    expect(proposal.action).toBe("create");
    const applied = applyTrajectoryDiagnosticEscalation(proposal, {
      projectDir,
      nowIso: "2026-05-29T12:00:00.000Z",
    });

    expect(applied.kind).toBe("created");
    const taskPath = join(projectDir, "data", "tasks", "ready", `${pattern.taskId}.md`);
    expect(existsSync(taskPath)).toBe(true);
    const task = readFileSync(taskPath, "utf-8");
    expect(task).toContain("status: ready");
    expect(task).toContain(pattern.fingerprint);
    expect(task).toContain(pattern.evidenceFingerprint);
    expect(task).toContain("Warning codes: missing_final_verification_after_edit");
    expect(task).toContain("2026-05-29T09-00-00-000Z-builder-task-0");
    expect(task).toContain("steps/build.trajectory-diagnostics.json");
    expect(task).not.toContain("RAW_PROMPT_SECRET");
    expect(task).not.toContain("FULL_TOOL_OUTPUT_SECRET");
    expect(assertTaskQueueValid(projectDir, { minReady: 1 }).errorCount).toBe(0);
  });

  it("does not create duplicate open tasks for the same pattern evidence", () => {
    for (const [index, hour] of [9, 10, 11].entries()) {
      seedTrajectoryRun(projectDir, {
        id: `2026-05-29T${String(hour).padStart(2, "0")}-00-00-000Z-builder-dupe-${index}`,
        hoursAgo: 3 - index,
        code: "missing_final_verification_after_edit",
      });
    }

    const pattern = detect(projectDir)[0]!;
    applyTrajectoryDiagnosticEscalation(
      proposeTrajectoryDiagnosticEscalation(projectDir, pattern),
      { projectDir, nowIso: "2026-05-29T12:00:00.000Z" },
    );
    const before = readFileSync(readyTaskPaths(projectDir)[0]!, "utf-8");

    const secondProposal = proposeTrajectoryDiagnosticEscalation(projectDir, pattern);
    expect(secondProposal.action).toBe("noop");
    const second = applyTrajectoryDiagnosticEscalation(secondProposal, {
      projectDir,
      nowIso: "2026-05-29T13:00:00.000Z",
    });

    expect(second.kind).toBe("noop");
    expect(readyTaskPaths(projectDir)).toHaveLength(1);
    expect(readFileSync(readyTaskPaths(projectDir)[0]!, "utf-8")).toBe(before);
  });

  it("formats operator attention entries without cost fields", () => {
    const digest = buildTrajectoryDiagnosticAttentionDigest([
      {
        workflow: "builder",
        stepId: "build",
        code: "missing_final_verification_after_edit",
        taskId: "task-repair-trajectory-diagnostic-pattern-abc123def456",
        action: "created",
        runIds: ["run-a", "run-b", "run-c"],
      },
    ]);

    expect(digest.items[0].detail).toContain("task-repair-trajectory-diagnostic-pattern");
    expect(digest.items[0].detail).toContain("run-a, run-b, run-c");
    expect(JSON.stringify(digest)).not.toMatch(/cost|throughput/i);
  });
});
