import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  getRepoTaskStateDir,
  getRepoTasksDir,
  moveTaskById,
  REPO_TASK_STATES,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { buildOwnerInterventionTaskBody } from "./owner-intervention-escalation-task-body.js";
import {
  type ExistingOwnerInterventionTask,
  OWNER_INTERVENTION_EVIDENCE_FINGERPRINT_RE,
  type OwnerInterventionEscalationApplied,
  type OwnerInterventionEscalationContext,
  type OwnerInterventionEscalationProposal,
  type OwnerInterventionPattern,
} from "./owner-intervention-escalation-types.js";

function findExistingTask(
  projectDir: string,
  taskId: string,
): ExistingOwnerInterventionTask | null {
  const tasksDir = getRepoTasksDir(projectDir);
  for (const state of REPO_TASK_STATES) {
    const candidate = join(tasksDir, state, `${taskId}.md`);
    if (!existsSync(candidate)) continue;
    const content = readFileSync(candidate, "utf-8");
    const { attrs } = parseFlatFrontMatter(content);
    return {
      state,
      path: candidate,
      content,
      evidenceFingerprint:
        content.match(OWNER_INTERVENTION_EVIDENCE_FINGERPRINT_RE)?.[1] ?? null,
      createdAt: typeof attrs.created_at === "string" ? attrs.created_at : null,
    };
  }
  return null;
}

export function proposeOwnerInterventionEscalation(
  projectDir: string,
  pattern: OwnerInterventionPattern,
): OwnerInterventionEscalationProposal {
  const existing = findExistingTask(projectDir, pattern.taskId);
  if (!existing) return { action: "create", pattern, target: "ready" };
  if (existing.state === "doing" || existing.state === "blocked") {
    return {
      action: "noop",
      pattern,
      reason: `${pattern.taskId} is already in ${existing.state}/; leaving the in-flight repair alone.`,
      existingState: existing.state,
    };
  }
  if (
    existing.evidenceFingerprint === pattern.evidenceFingerprint &&
    existing.state !== "backlog"
  ) {
    return {
      action: "noop",
      pattern,
      reason: `${pattern.taskId} already records this owner-intervention evidence in ${existing.state}/.`,
      existingState: existing.state,
    };
  }
  if (existing.state === "ready") {
    return {
      action: "refresh",
      pattern,
      target: "ready",
      previousEvidenceFingerprint: existing.evidenceFingerprint,
    };
  }
  if (existing.state === "backlog") {
    return {
      action: "promote",
      pattern,
      fromState: "backlog",
      target: "ready",
      previousEvidenceFingerprint: existing.evidenceFingerprint,
    };
  }
  return {
    action: "recreate",
    pattern,
    previousState: existing.state,
    target: "ready",
    previousEvidenceFingerprint: existing.evidenceFingerprint,
  };
}

function taskTimestamps(
  existing: ExistingOwnerInterventionTask | null,
  nowIso: string,
): { createdAt: string; updatedAt: string } {
  return {
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

function buildOwnerInterventionTaskFile(
  pattern: OwnerInterventionPattern,
  timestamps: { createdAt: string; updatedAt: string },
): string {
  return serializeFlatFrontMatter(
    {
      id: pattern.taskId,
      title: `Repair recurring owner intervention for ${pattern.dimension.value}`,
      status: "ready",
      priority: "p2",
      area: "autonomy",
      task_class: "Safety",
      summary:
        `Reduce repeated ${pattern.kind.replace("repeated-", "").replace(/-/g, " ")} ` +
        `for ${pattern.dimension.kind} ${pattern.dimension.value} without exposing owner answers.`,
      created_at: timestamps.createdAt,
      updated_at: timestamps.updatedAt,
    },
    buildOwnerInterventionTaskBody(pattern),
  );
}

function stagePath(projectDir: string, path: string): void {
  execFileSync("git", ["add", path], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
  });
}

function writeReadyTask(
  projectDir: string,
  pattern: OwnerInterventionPattern,
  existing: ExistingOwnerInterventionTask | null,
  nowIso: string,
): string {
  const targetDir = getRepoTaskStateDir(projectDir, "ready");
  const targetPath = join(targetDir, `${pattern.taskId}.md`);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(
    targetPath,
    buildOwnerInterventionTaskFile(pattern, taskTimestamps(existing, nowIso)),
    "utf-8",
  );
  stagePath(projectDir, targetPath);
  return targetPath;
}

export function applyOwnerInterventionEscalation(
  proposal: OwnerInterventionEscalationProposal,
  ctx: OwnerInterventionEscalationContext,
): OwnerInterventionEscalationApplied {
  const { pattern } = proposal;
  if (proposal.action === "noop") {
    return {
      kind: "noop",
      taskId: pattern.taskId,
      patternFingerprint: pattern.fingerprint,
      reason: proposal.reason,
      ...(proposal.existingState ? { existingState: proposal.existingState } : {}),
    };
  }
  const existing = findExistingTask(ctx.projectDir, pattern.taskId);
  const targetPath = join(
    getRepoTaskStateDir(ctx.projectDir, "ready"),
    `${pattern.taskId}.md`,
  );
  if (proposal.action === "create" && existsSync(targetPath)) {
    throw new Error(`owner-intervention-escalation: refusing to overwrite existing ${targetPath}`);
  }
  if (proposal.action === "refresh" && (!existing || existing.state !== "ready")) {
    throw new Error(`owner-intervention-escalation: expected ${pattern.taskId} in ready/ for refresh`);
  }
  if (proposal.action === "create" || proposal.action === "refresh") {
    const written = writeReadyTask(ctx.projectDir, pattern, existing, ctx.nowIso);
    return {
      kind: proposal.action === "create" ? "created" : "refreshed",
      taskId: pattern.taskId,
      patternFingerprint: pattern.fingerprint,
      path: written.slice(ctx.projectDir.length + 1),
    };
  }
  if (proposal.action === "promote") {
    const move = moveTaskById(ctx.projectDir, pattern.taskId, "ready");
    const promoted = findExistingTask(ctx.projectDir, pattern.taskId);
    writeReadyTask(ctx.projectDir, pattern, promoted, ctx.nowIso);
    return {
      kind: "promoted",
      taskId: pattern.taskId,
      patternFingerprint: pattern.fingerprint,
      fromState: "backlog",
      path: move.path,
      previousPath: move.previousPath,
    };
  }
  const previousPath = join(
    getRepoTaskStateDir(ctx.projectDir, proposal.previousState),
    `${pattern.taskId}.md`,
  );
  if (!existsSync(previousPath)) {
    throw new Error(
      `owner-intervention-escalation: expected ${pattern.taskId} in ${proposal.previousState}/ for recreate`,
    );
  }
  if (existsSync(targetPath)) {
    throw new Error(`owner-intervention-escalation: refusing to overwrite existing ${targetPath}`);
  }
  execFileSync("git", ["mv", previousPath, targetPath], {
    cwd: ctx.projectDir,
    env: withProtectedGitBareRepositoryEnv(),
  });
  const written = writeReadyTask(ctx.projectDir, pattern, existing, ctx.nowIso);
  return {
    kind: "recreated",
    taskId: pattern.taskId,
    patternFingerprint: pattern.fingerprint,
    previousState: proposal.previousState,
    path: written.slice(ctx.projectDir.length + 1),
  };
}
