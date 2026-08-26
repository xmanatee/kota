import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import type {
  listFullRepoTasks,
  RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";

export type SemanticTaskTransition = {
  id: string;
  fromState: RepoTaskState | null;
  toState: RepoTaskState | null;
  refs: string[];
};

type ChangedTaskPath = {
  oldPath: string | null;
  newPath: string | null;
};

function taskState(path: string): RepoTaskState | null {
  const match = path.match(
    /^data\/tasks\/(backlog|ready|doing|blocked|done|dropped)\/(task-[^/]+)\.md$/,
  );
  return (match?.[1] as RepoTaskState | undefined) ?? null;
}

function taskId(path: string): string | null {
  return path.match(/^data\/tasks\/[^/]+\/(task-[^/]+)\.md$/)?.[1] ?? null;
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
  projectDir: string,
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
      cwd: projectDir,
      timeoutMs: 30_000,
      outputLimitBytes: 20 * 1024 * 1024,
      captureLimitBytesPerStream: 20 * 1024 * 1024,
    });
    return parseChangedTaskPaths(result.stdout.text);
  } catch {
    return null;
  }
}

export function taskTransitions(
  paths: readonly ChangedTaskPath[],
): SemanticTaskTransition[] {
  const byId = new Map<
    string,
    { fromState: RepoTaskState | null; toState: RepoTaskState | null; refs: Set<string> }
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
      if (change.oldPath === path) current.fromState = taskState(path);
      if (change.newPath === path) current.toState = taskState(path);
      byId.set(id, current);
    }
  }
  return [...byId.entries()].map(([id, transition]) => ({
    id,
    fromState: transition.fromState,
    toState: transition.toState,
    refs: [...transition.refs].sort((a, b) => a.localeCompare(b)),
  }));
}

export function isStrategicCompletion(args: {
  toState: RepoTaskState | null;
  fromState: RepoTaskState | null;
  task: ReturnType<typeof listFullRepoTasks>[number] | undefined;
}): boolean {
  if (args.toState !== "done" || args.fromState === "done" || !args.task) {
    return false;
  }
  return (
    args.task.anchor ||
    ((args.task.priority === "p0" || args.task.priority === "p1") &&
      /^## (?:Initiative|Milestone)$/m.test(args.task.body))
  );
}
