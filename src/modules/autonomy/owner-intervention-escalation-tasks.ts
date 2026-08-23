import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  getRepoTasksDir,
  REPO_TASK_STATES,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  type ExistingOwnerInterventionTask,
  OWNER_INTERVENTION_EVIDENCE_FINGERPRINT_RE,
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
