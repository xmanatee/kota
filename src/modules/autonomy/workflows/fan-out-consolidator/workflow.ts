/**
 * Fan-out consolidator workflow.
 *
 * Triggers after each builder commit and on the rolling cadence emitted by
 * the dispatcher. Reads the current done queue, detects completed multi-
 * client fan-out batches, and seeds one consolidation review task in
 * `ready/` per new batch. Idempotent: re-running with the same batch state
 * is a noop.
 *
 * Code-only workflow — no agent step. The seeded task is the actionable
 * artifact; a builder run will pick it up and a critic will review the
 * result. The rendered-evidence validator gate catches the case where the
 * builder tries to clear the consolidation with prose-only test logs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/types.js";
import { checkCommitStageable, commitWorkflowChanges } from "#modules/autonomy/commit.js";
import {
  type FanOutConsolidationArtifact,
  seedFanOutConsolidationTasks,
} from "#modules/autonomy/fan-out-consolidation.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitted,
} from "#modules/autonomy/shared.js";

type DetectionInspection = {
  dirty: boolean;
  artifact: FanOutConsolidationArtifact;
  touchedDisk: boolean;
};

const detectAndSeed = typedCodeStep<DetectionInspection>({
  id: "detect-and-seed",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) =>
    expectStructuredOutput<DetectionInspection>(raw, [
      "dirty",
      "artifact",
      "touchedDisk",
    ]),
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    const dirty = worktree.available && worktree.trackedDirty;
    if (dirty) {
      const now = new Date();
      return {
        dirty,
        touchedDisk: false,
        artifact: {
          generatedAt: now.toISOString(),
          detection: { windowMs: 0, minSurfaces: 0, nowMs: now.getTime() },
          batches: [],
          proposals: [],
          applied: [],
        },
      };
    }
    const now = new Date();
    const result = seedFanOutConsolidationTasks({
      projectDir,
      nowMs: now.getTime(),
      nowIso: now.toISOString(),
    });
    return {
      dirty,
      touchedDisk: result.touchedDisk,
      artifact: result.artifact,
    };
  },
});

const writeArtifact = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-artifact",
  type: "code",
  when: (ctx) => detectAndSeed.output(ctx) !== undefined,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, ["written", "path"]),
  run: (ctx) => {
    const inspection = detectAndSeed.outputRequired(ctx);
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    const artifactPath = join(ctx.workflow.runDirPath, "fan-out-consolidation.json");
    writeFileSync(artifactPath, `${JSON.stringify(inspection.artifact, null, 2)}\n`);
    return { written: true, path: artifactPath };
  },
});

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) => detectAndSeed.output(ctx)?.touchedDisk === true,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: (ctx) => {
    const inspection = detectAndSeed.outputRequired(ctx);
    const created = inspection.artifact.applied.filter((a) => a.kind === "created");
    const lines: string[] = [
      `fan-out-consolidator: seed ${created.length} consolidation review task(s) in ready/`,
      "",
    ];
    for (const apply of created) {
      if (apply.kind !== "created") continue;
      lines.push(`- ${apply.taskId} — capability \`${apply.capabilityKey}\``);
    }
    lines.push("");
    lines.push(
      "Each review task names IA, contract consistency, duplicated rendering, runtime",
    );
    lines.push(
      "evidence, and accepted critic warnings as required Done When dimensions.",
    );
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    writeFileSync(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `${lines.join("\n")}\n`,
    );
    return { written: true };
  },
});

const validateBeforeCommit = typedCodeStep<{ ok: true }>({
  id: "validate-before-commit",
  type: "code",
  when: (ctx) => writeCommitMessage.output(ctx)?.written === true,
  validate: (raw) => {
    const obj = expectStructuredOutput<{ ok: true }>(raw, ["ok"]);
    if (obj.ok !== true) throw new Error(`expected ok: true, got ${String(obj.ok)}`);
    return obj;
  },
  run: (ctx) => {
    runCheck("pnpm run validate-tasks", ctx.projectDir);
    checkNoScratchArtifacts(ctx.projectDir);
    checkCommitStageable(ctx.projectDir);
    checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir);
    return { ok: true } as const;
  },
});

const commitChanges = typedCodeStep<{ committed: boolean }>({
  id: "commit",
  type: "code",
  when: (ctx) => validateBeforeCommit.output(ctx)?.ok === true,
  validate: (raw) =>
    expectStructuredOutput<{ committed: boolean }>(raw, ["committed"]),
  run: ({ projectDir, workflow }) => {
    const result = commitWorkflowChanges(projectDir, workflow.runDirPath);
    return { committed: Boolean(result.committed) };
  },
});

const fanOutConsolidatorWorkflow: WorkflowDefinitionInput = {
  name: "fan-out-consolidator",
  description:
    "Detect completed multi-client fan-out batches and seed one consolidation review task per new batch in ready/.",
  tags: ["monitored"],
  recoveryCapable: true,
  // Code-only workflow — no agent step. defaultAutonomyMode is omitted.
  triggers: [
    { event: "workflow.build.committed" },
    { event: "runtime.recovered" },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({
          projectDir,
          workflowName: "fan-out-consolidator",
        }),
    },
    detectAndSeed,
    writeArtifact,
    writeCommitMessage,
    validateBeforeCommit,
    commitChanges,
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitted("commit"),
      reason: "fan-out-consolidator committed seeded consolidation tasks",
      requires: ["commit"],
    },
  ],
};

export default fanOutConsolidatorWorkflow;
