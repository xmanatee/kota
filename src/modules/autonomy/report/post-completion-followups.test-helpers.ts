import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";

export const NOW = Date.parse("2026-04-29T12:00:00.000Z");
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function createPostCompletionFollowUpsFixture(): {
  projectDir: string;
  runsDir: string;
  cleanup: () => void;
} {
  const projectDir = join(
    tmpdir(),
    `post-completion-followups-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const runsDir = join(projectDir, ".kota", "runs");
  mkdirSync(runsDir, { recursive: true });

  return {
    projectDir,
    runsDir,
    cleanup: () => rmSync(projectDir, { recursive: true, force: true }),
  };
}

export function writeTask(
  projectDir: string,
  state: string,
  id: string,
  attrs: {
    priority: string;
    area: string;
    title?: string;
    summary?: string;
    updatedAt?: string;
    body?: string;
  },
): void {
  const dir = join(projectDir, "data", "tasks", state);
  mkdirSync(dir, { recursive: true });
  const updatedAt = attrs.updatedAt ?? new Date(NOW).toISOString();
  const title = attrs.title ?? id;
  const summary = attrs.summary ?? "fixture task";
  const body = attrs.body ?? "## Problem\n\nFixture task.\n";
  const content =
    `---\nid: ${id}\ntitle: ${title}\nstatus: ${state}\npriority: ${attrs.priority}\n` +
    `area: ${attrs.area}\nsummary: ${summary}\ncreated_at: ${updatedAt}\nupdated_at: ${updatedAt}\n---\n\n${body}`;
  writeFileSync(join(dir, `${id}.md`), content, "utf-8");
}

export function writeRun(
  runsDir: string,
  id: string,
  metadata: {
    workflow: string;
    startedAt: string;
    status: string;
  },
): void {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      id,
      definitionPath: `src/modules/autonomy/workflows/${metadata.workflow}/workflow.ts`,
      trigger: { event: "schedule", payload: {} },
      runDir: `.kota/runs/${id}`,
      durationMs: 1000,
      totalCostUsd: null,
      steps: [],
      ...metadata,
    }),
  );
}

export function writeRunSummary(
  runsDir: string,
  id: string,
  taskId: string,
  commitSha: string,
): void {
  writeFileSync(
    join(runsDir, id, "run-summary.json"),
    JSON.stringify({
      runId: id,
      workflow: "builder",
      taskId,
      taskTitle: taskId,
      outcome: "success",
      commitSha,
      commitMessage: "complete fixture task",
      filesChanged: [],
      costUsd: null,
      durationMs: null,
      completedAt: new Date(NOW - MS_PER_DAY).toISOString(),
    }),
  );
}

export function taskWithText(text: string): RepoTaskFullRecord {
  return {
    id: "task-fixture",
    title: "Fixture task",
    state: "ready",
    priority: "p2",
    area: "autonomy",
    taskClass: "Meta",
    summary: text,
    updatedAt: new Date(NOW).toISOString(),
    body: `## Problem\n\n${text}\n`,
    dependsOn: [],
    anchor: false,
  };
}
