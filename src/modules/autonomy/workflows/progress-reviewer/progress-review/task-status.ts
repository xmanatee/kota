import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  getRepoTaskContainerDir,
  REPO_TASK_STATES,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";

function taskPathForId(workspaceRoot: string, state: RepoTaskState, id: string): string {
  return join(getRepoTaskContainerDir(workspaceRoot, state), `${id}.md`);
}

export function readTaskStatus(workspaceRoot: string, id: string): string | null {
  for (const state of REPO_TASK_STATES) {
    const file = taskPathForId(workspaceRoot, state, id);
    if (!existsSync(file)) continue;
    const { attrs } = parseFlatFrontMatter(readFileSync(file, "utf-8"));
    const status = attrs.status;
    return typeof status === "string" ? status : null;
  }
  return null;
}
