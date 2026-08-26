import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type {
  RepoTaskFullRecord,
  RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";

export const NOW = Date.parse("2026-07-07T12:00:00.000Z");

export function createKnownStores(projectDir: string): void {
  mkdirSync(join(projectDir, ".kota", "approvals"), { recursive: true });
  mkdirSync(join(projectDir, ".kota", "owner-questions"), { recursive: true });
  mkdirSync(join(projectDir, ".kota", "dead-letter-queue"), {
    recursive: true,
  });
  writeDeadLetters(projectDir, []);
}

export function writeTask(
  projectDir: string,
  state: RepoTaskState,
  id: string,
  taskClass: RepoTaskFullRecord["taskClass"],
  priority: string,
): RepoTaskFullRecord {
  const dir = join(projectDir, "data", "tasks", state);
  mkdirSync(dir, { recursive: true });
  const title = `${id} title`;
  const summary = `${id} summary`;
  const updatedAt = new Date(NOW).toISOString();
  const body = "## Problem\n\nFixture task.\n";
  const content =
    `---\nid: ${id}\ntitle: ${title}\nstatus: ${state}\npriority: ${priority}\n` +
    `area: autonomy\ntask_class: ${taskClass}\nsummary: ${summary}\n` +
    `created_at: ${updatedAt}\nupdated_at: ${updatedAt}\n---\n\n${body}`;
  writeFileSync(join(dir, `${id}.md`), content, "utf-8");
  return {
    id,
    title,
    state,
    priority,
    area: "autonomy",
    taskClass,
    summary,
    updatedAt,
    body,
    dependsOn: [],
    anchor: false,
  };
}

export function writeApproval(
  projectDir: string,
  id: string,
  status: "pending" | "approved",
): void {
  const dir = join(projectDir, ".kota", "approvals");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.json`),
    `${JSON.stringify(
      {
        id,
        tool: "Bash",
        input: {},
        risk: "write",
        reason: "fixture",
        createdAt: new Date(NOW).toISOString(),
        status,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

export function writeOwnerQuestion(
  projectDir: string,
  id: string,
  status: "pending" | "answered",
  taskId: string,
): void {
  const dir = join(projectDir, ".kota", "owner-questions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.json`),
    `${JSON.stringify(
      {
        id,
        seq: 1,
        context: "fixture",
        question: "Proceed?",
        reason: "fixture",
        source: "test",
        answerBehavior: "workflow-resume",
        origin: {
          kind: "workflow",
          workflowName: "builder",
          runId: "run-question",
          stepId: "ask",
          taskId,
        },
        createdAt: new Date(NOW).toISOString(),
        status,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

export function writeDeadLetters(
  projectDir: string,
  items: {
    id: string;
    status: "open" | "dismissed";
    scopeId: string;
    projectId: string;
  }[],
): void {
  const dir = join(projectDir, ".kota", "dead-letter-queue");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "items.json"),
    `${JSON.stringify(
      {
        items: items.map((item) => ({
          ...item,
          type: "workflow-dispatch",
          affectedWorkflowNames: ["builder"],
          source: {
            kind: "workflow-dispatch",
            workflowName: "builder",
            triggerEvent: "autonomy.queue.available",
            triggerSchemaRef: null,
            failedRunId: "run-dlq",
          },
        })),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

export function runningRun(
  projectDir: string,
  id: string,
  workflow: string,
  taskId: string,
  scopeId: string,
  projectId: string,
): WorkflowRunMetadata {
  return {
    id,
    workflow,
    definitionPath: `src/modules/autonomy/workflows/${workflow}/workflow.ts`,
    trigger: {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: { taskId, scopeId, projectId },
    },
    startedAt: new Date(NOW).toISOString(),
    status: "running",
    runDir: join(projectDir, ".kota", "runs", id),
    steps: [],
  } as WorkflowRunMetadata;
}
