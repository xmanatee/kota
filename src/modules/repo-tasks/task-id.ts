export const REPO_TASK_ID_PATTERN = /^task-[a-z0-9-]+$/;

export function isRepoTaskId(value: string): boolean {
  return REPO_TASK_ID_PATTERN.test(value);
}
