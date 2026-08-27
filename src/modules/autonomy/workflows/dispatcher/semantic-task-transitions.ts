import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import type {
  listFullRepoTasks,
  RepoTaskPriority,
  RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";

type TaskRevisionSnapshot = {
  state: RepoTaskState;
  priority: RepoTaskPriority | null;
  body: string;
};

export type SemanticTaskTransition = {
  id: string;
  fromState: RepoTaskState | null;
  toState: RepoTaskState | null;
  previousTask?: TaskRevisionSnapshot;
  refs: string[];
};

type ChangedTaskPath = {
  oldPath: string | null;
  newPath: string | null;
  oldTask?: TaskRevisionSnapshot;
  newTask?: TaskRevisionSnapshot;
};

function taskState(path: string): RepoTaskState | null {
  if (/^data\/tasks\/archive\/task-[^/]+\.md$/.test(path)) return "done";
  if (/^data\/tasks\/task-[^/]+\.md$/.test(path)) return "open";
  return null;
}

function taskId(path: string): string | null {
  return path.match(/^data\/tasks\/(?:archive\/)?(task-[^/]+)\.md$/)?.[1] ?? null;
}

export function parseChangedTaskPaths(output: string): ChangedTaskPath[] {
  const normalized = output.trim();
  if (!normalized) return [];
  return normalized.split("\n").flatMap((line): ChangedTaskPath[] => {
    const fields = line.split("\t");
    const status = fields[0] ?? "";
    if (status.startsWith("R") && fields[1] && fields[2]) {
      return [{ oldPath: fields[1], newPath: fields[2] }];
    }
    if (status === "A" && fields[1]) {
      return [{ oldPath: null, newPath: fields[1] }];
    }
    if (status === "D" && fields[1]) {
      return [{ oldPath: fields[1], newPath: null }];
    }
    if (fields[1]) return [{ oldPath: fields[1], newPath: fields[1] }];
    return [];
  });
}

export async function changedTaskPaths(
  runCommand: WorkflowCommandRunner,
  workspaceRoot: string,
  fromHead: string,
  toHead: string,
): Promise<ChangedTaskPath[] | null> {
  if (!fromHead || !toHead || fromHead === toHead) return [];
  try {
    const result = await runCommand({
      command: "git",
      args: [
        "diff",
        "--name-status",
        "--find-renames",
        `${fromHead}..${toHead}`,
        "--",
        "data/tasks",
      ],
      cwd: workspaceRoot,
      timeoutMs: 30_000,
      outputLimitBytes: 20 * 1024 * 1024,
      captureLimitBytesPerStream: 20 * 1024 * 1024,
    });
    const changes = parseChangedTaskPaths(result.stdout.text);
    return await Promise.all(
      changes.map(async (change) => ({
        ...change,
        ...(change.oldPath
          ? { oldTask: await readTaskAtRevision(runCommand, workspaceRoot, fromHead, change.oldPath) }
          : {}),
        ...(change.newPath
          ? { newTask: await readTaskAtRevision(runCommand, workspaceRoot, toHead, change.newPath) }
          : {}),
      })),
    );
  } catch {
    return null;
  }
}

async function readTaskAtRevision(
  runCommand: WorkflowCommandRunner,
  workspaceRoot: string,
  revision: string,
  path: string,
): Promise<TaskRevisionSnapshot | undefined> {
  try {
    const result = await runCommand({
      command: "git",
      args: ["show", `${revision}:${path}`],
      cwd: workspaceRoot,
      timeoutMs: 30_000,
      outputLimitBytes: 2 * 1024 * 1024,
      captureLimitBytesPerStream: 2 * 1024 * 1024,
    });
    const { attrs, body } = parseFlatFrontMatter(result.stdout.text);
    const state = attrs.status;
    if (
      typeof state !== "string" ||
      !(["open", "blocked", "done", "dropped"] as const).includes(
        state as RepoTaskState,
      )
    ) {
      return undefined;
    }
    const rawPriority = attrs.priority;
    const priority = typeof rawPriority === "string" && /^(p0|p1|p2|p3)$/.test(rawPriority)
      ? rawPriority as RepoTaskPriority
      : null;
    return { state: state as RepoTaskState, priority, body };
  } catch {
    return undefined;
  }
}

export function taskTransitions(
  paths: readonly ChangedTaskPath[],
): SemanticTaskTransition[] {
  const byId = new Map<
    string,
    {
      fromState: RepoTaskState | null;
      toState: RepoTaskState | null;
      previousTask?: TaskRevisionSnapshot;
      refs: Set<string>;
    }
  >();
  for (const change of paths) {
    for (const path of [change.oldPath, change.newPath]) {
      if (!path) continue;
      const id = taskId(path);
      if (!id) continue;
      const current = byId.get(id) ?? {
        fromState: null,
        toState: null,
        refs: new Set<string>(),
      };
      current.refs.add(path);
      if (change.oldPath === path) {
        current.fromState = change.oldTask?.state ?? taskState(path);
        if (change.oldTask) current.previousTask = change.oldTask;
      }
      if (change.newPath === path) {
        current.toState = change.newTask?.state ?? taskState(path);
      }
      byId.set(id, current);
    }
  }
  return [...byId.entries()].map(([id, transition]) => ({
    id,
    fromState: transition.fromState,
    toState: transition.toState,
    ...(transition.previousTask ? { previousTask: transition.previousTask } : {}),
    refs: [...transition.refs].sort((a, b) => a.localeCompare(b)),
  }));
}

export function isStrategicCompletion(args: {
  toState: RepoTaskState | null;
  fromState: RepoTaskState | null;
  task: ReturnType<typeof listFullRepoTasks>[number] | undefined;
  previousTask?: TaskRevisionSnapshot;
}): boolean {
  if (args.toState !== "done" || args.fromState === "done") {
    return false;
  }
  const priority = args.task?.priority ?? args.previousTask?.priority;
  const body = args.task?.body ?? args.previousTask?.body;
  return (
    (priority === "p0" || priority === "p1") &&
      typeof body === "string" &&
      /^## (?:Initiative|Milestone)$/m.test(body)
  );
}
