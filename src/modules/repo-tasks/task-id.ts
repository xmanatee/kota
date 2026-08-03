const REPO_TASK_ID_SOURCE = "task-[a-z0-9-]+";

export const REPO_TASK_ID_PATTERN = new RegExp(`^${REPO_TASK_ID_SOURCE}$`);
const REPO_TASK_ID_SCAN_PATTERN = new RegExp(
  `(?:^|[^a-z0-9-])(${REPO_TASK_ID_SOURCE})(?![a-z0-9-])`,
  "g",
);

export function isRepoTaskId(value: string): boolean {
  return REPO_TASK_ID_PATTERN.test(value);
}

export function extractRepoTaskIds(value: string): string[] {
  return [...value.matchAll(REPO_TASK_ID_SCAN_PATTERN)].map((match) => match[1]!);
}
