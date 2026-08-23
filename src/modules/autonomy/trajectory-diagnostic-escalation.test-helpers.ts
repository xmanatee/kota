import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  TrajectoryDiagnosticCode,
  TrajectoryDiagnosticsArtifact,
} from "#core/agent-harness/index.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { detectRecurringTrajectoryDiagnosticPatterns } from "./trajectory-diagnostic-escalation.js";

const NOW = Date.parse("2026-05-29T12:00:00.000Z");

export function makeTrajectoryDiagnosticProjectDir(): string {
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

export function supportedArtifactWithUnsupportedDiagnostic(): TrajectoryDiagnosticsArtifact {
  return {
    ...artifactFor("unsupported_trajectory"),
    status: "supported",
    emitsAgentMessageStream: true,
  };
}

export function legacyCleanArtifact(): { status: "ok"; counts: { warningCount: 0 } } {
  return {
    status: "ok",
    counts: { warningCount: 0 },
  };
}

export function seedTrajectoryRun(
  projectDir: string,
  opts: {
    id: string;
    hoursAgo: number;
    code: TrajectoryDiagnosticCode | null;
    artifact?:
      | TrajectoryDiagnosticsArtifact
      | { status: "ok"; counts: { warningCount: 0 } };
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
    trigger: { event: "workflow.completed", schemaRef: null, payload: {} },
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

export function detectTrajectoryPatterns(projectDir: string) {
  return detectRecurringTrajectoryDiagnosticPatterns(
    join(projectDir, ".kota", "runs"),
    { nowMs: NOW },
  );
}
