import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  getRepoTaskStateDir,
  REPO_TASK_STATES,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";

function taskPathForId(projectDir: string, state: RepoTaskState, id: string): string {
  return join(getRepoTaskStateDir(projectDir, state), `${id}.md`);
}

export function readTaskStatus(projectDir: string, id: string): string | null {
  for (const state of REPO_TASK_STATES) {
    const file = taskPathForId(projectDir, state, id);
    if (!existsSync(file)) continue;
    const { attrs } = parseFlatFrontMatter(readFileSync(file, "utf-8"));
    const status = attrs.status;
    return typeof status === "string" ? status : null;
  }
  return null;
}
