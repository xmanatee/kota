import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type {
  RepoTaskFullRecord,
  RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";

export const NOW = Date.parse("2026-07-07T12:00:00.000Z");

export function createKnownStores(workspaceRoot: string): void {
  mkdirSync(join(workspaceRoot, ".kota", "approvals"), { recursive: true });
  mkdirSync(join(workspaceRoot, ".kota", "owner-questions"), { recursive: true });
  mkdirSync(join(workspaceRoot, ".kota", "dead-letter-queue"), {
    recursive: true,
  });
  writeDeadLetters(workspaceRoot, []);
}

export function writeTask(
  workspaceRoot: string,
  state: RepoTaskState,
  id: string,
  priority: RepoTaskFullRecord["priority"],
): RepoTaskFullRecord {
  const dir = state === "done" || state === "dropped"
    ? join(workspaceRoot, "data", "tasks", "archive")
    : join(workspaceRoot, "data", "tasks");
  mkdirSync(dir, { recursive: true });
  const title = `${id} title`;
  const body = `# ${title}\n\n## Problem\n\nFixture task.\n`;
  const content = state === "done" || state === "dropped"
    ? `---\nstatus: ${state}\n---\n\n${body}`
    : `---\nstatus: ${state}\npriority: ${priority}\n---\n\n${body}`;
  writeFileSync(join(dir, `${id}.md`), content, "utf-8");
  return {
    id,
    title,
    state,
    priority,
    body,
    dependsOn: [],
  };
}

export function writeApproval(
  workspaceRoot: string,
  id: string,
  status: "pending" | "approved",
): void {
  const dir = join(workspaceRoot, ".kota", "approvals");
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
  workspaceRoot: string,
  id: string,
  status: "pending" | "answered",
  taskId: string,
): void {
  const dir = join(workspaceRoot, ".kota", "owner-questions");
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
  workspaceRoot: string,
  items: {
    id: string;
    status: "open" | "dismissed";
    scopeId: string;
  }[],
): void {
  const dir = join(workspaceRoot, ".kota", "dead-letter-queue");
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
  workspaceRoot: string,
  id: string,
  workflow: string,
  taskId: string,
  scopeId: string,
): WorkflowRunMetadata {
  return {
    id,
    workflow,
    definitionPath: `src/modules/autonomy/workflows/${workflow}/workflow.ts`,
    trigger: {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: { taskId, scopeId },
    },
    startedAt: new Date(NOW).toISOString(),
    status: "running",
    runDir: join(workspaceRoot, ".kota", "runs", id),
    steps: [],
  } as WorkflowRunMetadata;
}
