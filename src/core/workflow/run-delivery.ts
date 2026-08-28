import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import type {
  WorkflowDeliveryDisposition,
  WorkflowRunMetadata,
} from "./run-types.js";
import { readWriterIntegrationEvidence } from "./writer-integration-evidence.js";

function parseTaskFileFrontMatter(path: string): { status?: string; body?: string } | null {
  try {
    if (!existsSync(path)) return null;
    const content = readFileSync(path, "utf-8");
    const parsed = parseFlatFrontMatter(content);
    return {
      status: typeof parsed.attrs.status === "string" ? parsed.attrs.status : undefined,
      body: parsed.body,
    };
  } catch {
    return null;
  }
}

function extractBlockerFromTaskContent(body?: string): string | null {
  if (!body) return null;
  const blockedOnMatch = body.match(/##\s*(?:Blocked on|Unblock Precondition)[\s\S]*?(?=\n##|$)/i);
  if (blockedOnMatch) {
    const section = blockedOnMatch[0].trim();
    const kindMatch = section.match(/kind:\s*([^\n]+)/i);
    const descMatch = section.match(/description:\s*([^\n]+)/i);
    if (kindMatch && descMatch) {
      return `${kindMatch[1].trim()}: ${descMatch[1].trim()}`;
    }
    if (kindMatch) return kindMatch[1].trim();
    const lines = section
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("```"));
    if (lines.length > 0) return lines.join("; ");
  }
  return null;
}

export function deriveWorkflowRunDelivery(
  metadata: WorkflowRunMetadata,
  options?: { runsDir?: string; scopeRoot?: string; workspaceRoot?: string },
): WorkflowDeliveryDisposition {
  if (metadata.delivery) {
    return metadata.delivery;
  }

  const payload = metadata.trigger?.payload ?? {};
  const taskId = typeof payload.taskId === "string" ? payload.taskId : null;
  const taskTitle = typeof payload.title === "string" ? payload.title : null;

  if (metadata.status === "running") {
    return {
      kind: "unresolved",
      taskId,
      taskTitle,
      reason: "run is in progress",
    };
  }

  if (metadata.status === "interrupted") {
    return {
      kind: "cancelled",
      taskId,
      taskTitle,
      reason: "run was cancelled or interrupted",
    };
  }

  if (metadata.status === "failed") {
    const errorStep = metadata.steps.slice().reverse().find((s) => s.error);
    return {
      kind: "failed",
      taskId,
      taskTitle,
      reason: errorStep?.error ?? "run failed",
    };
  }

  // Non-task workflows
  if (metadata.workflow !== "builder" && !taskId) {
    return { kind: "not_applicable" };
  }

  if (!taskId) {
    return {
      kind: "unresolved",
      taskId: null,
      taskTitle: null,
      reason: "builder trigger missing task contract",
    };
  }

  const runsDir = options?.runsDir;
  let workspaceRoot = options?.workspaceRoot ?? options?.scopeRoot;
  if (!workspaceRoot && runsDir) {
    if (runsDir.endsWith("/.kota/runs") || runsDir.endsWith("/.kota/runs/")) {
      workspaceRoot = dirname(dirname(runsDir));
    }
  }
  const writerIntegration = runsDir
    ? readWriterIntegrationEvidence(runsDir, metadata.id)
    : null;

  if (writerIntegration) {
    const changedPaths = writerIntegration.changedPaths ?? [];
    const archivedPath = changedPaths.find(
      (p) =>
        p === `data/tasks/archive/${taskId}.md` ||
        p.endsWith(`/archive/${taskId}.md`),
    );
    if (archivedPath) {
      if (workspaceRoot) {
        const fullArchivedPath = join(workspaceRoot, archivedPath);
        const parsed = parseTaskFileFrontMatter(fullArchivedPath);
        if (parsed?.status === "dropped") {
          return { kind: "dropped", taskId, taskTitle };
        }
      }
      return { kind: "completed", taskId, taskTitle };
    }

    const taskPath = changedPaths.find(
      (p) =>
        p === `data/tasks/${taskId}.md` ||
        p === `data/tasks/blocked/${taskId}.md` ||
        p.includes(taskId),
    );
    if (taskPath) {
      let blocker: string | null = null;
      let isDropped = false;
      if (workspaceRoot) {
        const fullTaskPath = join(workspaceRoot, taskPath);
        const parsed = parseTaskFileFrontMatter(fullTaskPath);
        if (parsed?.status === "blocked") {
          blocker = extractBlockerFromTaskContent(parsed.body);
        } else if (parsed?.status === "dropped") {
          isDropped = true;
        }
      }
      if (isDropped) {
        return { kind: "dropped", taskId, taskTitle };
      }
      return {
        kind: "blocked",
        taskId,
        taskTitle,
        blocker: blocker ?? "task marked blocked",
      };
    }

    // If changedPaths is empty, check workspace files
    if (changedPaths.length === 0 && workspaceRoot) {
      const donePath = join(workspaceRoot, "data", "tasks", "archive", `${taskId}.md`);
      const doneParsed = parseTaskFileFrontMatter(donePath);
      if (doneParsed) {
        if (doneParsed.status === "dropped") {
          return { kind: "dropped", taskId, taskTitle };
        }
        return { kind: "completed", taskId, taskTitle };
      }
      const blockedPath = join(workspaceRoot, "data", "tasks", `${taskId}.md`);
      const blockedParsed = parseTaskFileFrontMatter(blockedPath);
      if (blockedParsed?.status === "blocked") {
        return {
          kind: "blocked",
          taskId,
          taskTitle,
          blocker: extractBlockerFromTaskContent(blockedParsed.body) ?? "task marked blocked",
        };
      }
    }

    if (changedPaths.length > 0) {
      return {
        kind: "unresolved",
        taskId,
        taskTitle,
        reason: "task file not modified in commit",
      };
    }

    return {
      kind: "unresolved",
      taskId,
      taskTitle,
      reason: "task file not found in workspace",
    };
  }

  // If no writer integration evidence on disk, check workspace
  if (workspaceRoot) {
    const donePath = join(workspaceRoot, "data", "tasks", "archive", `${taskId}.md`);
    const doneParsed = parseTaskFileFrontMatter(donePath);
    if (doneParsed) {
      if (doneParsed.status === "dropped") {
        return { kind: "dropped", taskId, taskTitle };
      }
      return { kind: "completed", taskId, taskTitle };
    }
    const blockedPath = join(workspaceRoot, "data", "tasks", `${taskId}.md`);
    const blockedParsed = parseTaskFileFrontMatter(blockedPath);
    if (blockedParsed?.status === "blocked") {
      return {
        kind: "blocked",
        taskId,
        taskTitle,
        blocker: extractBlockerFromTaskContent(blockedParsed.body) ?? "task marked blocked",
      };
    }
  }

  return {
    kind: "unresolved",
    taskId,
    taskTitle,
    reason: "integration evidence missing",
  };
}
