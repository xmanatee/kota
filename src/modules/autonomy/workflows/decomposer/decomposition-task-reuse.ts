import { join } from "node:path";
import { REPO_TASKS_DIR } from "#modules/repo-tasks/repo-tasks-domain.js";

export function decompositionTaskPath(state: string, id: string): string {
  return join(REPO_TASKS_DIR, state, `${id}.md`);
}

export function uniqueTaskIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

export function sameTaskIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((id, index) => id === right[index]);
}

export function addDecompositionSource(
  body: string,
  parentTaskId: string,
  failedRunId: string,
): string {
  const item = `- Reused for \`${parentTaskId}\` after builder run \`${failedRunId}\`.`;
  if (body.includes(item)) return body;
  const heading = /^## Decomposition Sources\s*$/m.exec(body);
  if (heading === null || heading.index === undefined) {
    return `${body.trim()}\n\n## Decomposition Sources\n\n${item}\n`;
  }
  const sectionStart = heading.index + heading[0].length;
  const following = body.slice(sectionStart);
  const nextHeadingOffset = following.search(/\n##\s+/);
  if (nextHeadingOffset < 0) {
    return `${body.trimEnd()}\n${item}\n`;
  }
  const insertionIndex = sectionStart + nextHeadingOffset;
  return `${body.slice(0, insertionIndex).trimEnd()}\n${item}\n\n${body.slice(insertionIndex).trimStart()}`;
}
