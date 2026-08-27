import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeWriterIntegrationFixture } from "#core/workflow/testing/writer-integration-fixture.js";
import type { RepoTaskFullRecord, RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";

export const NOW = Date.parse("2026-04-29T12:00:00.000Z");
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function createPostCompletionFollowUpsFixture(): {
  workspaceRoot: string;
  runsDir: string;
  cleanup: () => void;
} {
  const workspaceRoot = join(
    tmpdir(),
    `post-completion-followups-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const runsDir = join(workspaceRoot, ".kota", "runs");
  mkdirSync(runsDir, { recursive: true });

  return {
    workspaceRoot,
    runsDir,
    cleanup: () => rmSync(workspaceRoot, { recursive: true, force: true }),
  };
}

export function writeTask(
  workspaceRoot: string,
  state: RepoTaskState,
  id: string,
  attrs: {
    priority: string;
    title?: string;
    body?: string;
  },
): void {
  const dir = state === "done" || state === "dropped"
    ? join(workspaceRoot, "data", "tasks", "archive")
    : join(workspaceRoot, "data", "tasks");
  mkdirSync(dir, { recursive: true });
  const title = attrs.title ?? id;
  const body = attrs.body ?? "## Problem\n\nFixture task.\n";
  const content = state === "done" || state === "dropped"
    ? `---\nstatus: ${state}\n---\n\n# ${title}\n\n${body}`
    : `---\nstatus: ${state}\npriority: ${attrs.priority}\n---\n\n# ${title}\n\n${body}`;
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
      trigger: { event: "schedule", schemaRef: null, payload: {} },
      runDir: `.kota/runs/${id}`,
      durationMs: 1000,
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "unknown" },
      },
      steps: [],
      ...metadata,
    }),
  );
}

export function writeWriterIntegration(
  runsDir: string,
  id: string,
  taskId: string,
  commitSha: string,
): void {
  const metadataPath = join(runsDir, id, "metadata.json");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf-8")) as Record<
    string,
    unknown
  >;
  const taskDigest = "0".repeat(64);
  writeFileSync(
    metadataPath,
    JSON.stringify({
      ...metadata,
      trigger: {
        event: "autonomy.queue.available",
        schemaRef: null,
        payload: {
          taskId,
          taskPath: `data/tasks/${taskId}.md`,
          taskState: "open",
          taskDigest,
          idempotencyKey: `builder:${taskId}:${taskDigest}`,
          title: taskId,
        },
      },
    }),
  );
  writeWriterIntegrationFixture(runsDir, {
    runId: id,
    workflow: "builder",
    publishedHead: commitSha,
    commitSubject: "complete fixture task",
    commitMessage: "complete fixture task",
    completedAt: new Date(NOW - MS_PER_DAY).toISOString(),
  });
}

export function taskWithText(text: string): RepoTaskFullRecord {
  return {
    id: "task-fixture",
    title: "Fixture task",
    state: "open",
    priority: "p2",
    body: `## Problem\n\n${text}\n`,
    dependsOn: [],
  };
}
