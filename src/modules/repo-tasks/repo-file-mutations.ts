import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { readVerifiedRepoMarkdownFile } from "./repo-mutation-path-safety.js";
import {
  moveVerifiedRepoMarkdownFile,
  removeVerifiedRepoMarkdownFile,
  writeVerifiedRepoMarkdownFile,
} from "./repo-physical-file-mutations.js";

export { readVerifiedRepoMarkdownFile };

export const REPO_TASK_STAGING_OWNER_ENV = "KOTA_REPO_TASK_STAGING_OWNER";
export const REPO_TASK_WORKFLOW_HOST_STAGING_OWNER = "workflow-host";

const PROTECTED_GIT_INDEX_WRITE_ERROR =
  /index\.lock[\s\S]*(?:operation not permitted|permission denied|read-only file system)/i;

/**
 * Native builder agents cannot write linked-worktree Git metadata. Their
 * workflow host owns an exact-path staging repair before queue validation, so
 * only that explicitly declared owner may defer a protected-index failure.
 */
export function shouldDeferRepoTaskStagingToWorkflowHost(
  error: Error,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (
    env[REPO_TASK_STAGING_OWNER_ENV] !==
    REPO_TASK_WORKFLOW_HOST_STAGING_OWNER
  ) {
    return false;
  }
  return PROTECTED_GIT_INDEX_WRITE_ERROR.test(error.message);
}

function repoRelativePath(projectDir: string, filePath: string): string {
  const relativePath = relative(resolve(projectDir), resolve(filePath));
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
      `Repo mutation path must be inside project ${projectDir}: ${filePath}`,
    );
  }
  return relativePath;
}

export function stageRepoPaths(projectDir: string, filePaths: string[]): void {
  if (filePaths.length === 0) return;
  const relativePaths = filePaths.map((filePath) =>
    repoRelativePath(projectDir, filePath),
  );
  execFileSync("git", ["add", "-A", "--", ...relativePaths], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    stdio: "pipe",
  });
}

export function stageExistingOrTrackedRepoPaths(
  projectDir: string,
  filePaths: string[],
): string[] {
  const stageablePaths = filePaths.filter((filePath) => {
    if (existsSync(filePath)) return true;
    try {
      execFileSync(
        "git",
        [
          "ls-files",
          "--error-unmatch",
          "--",
          repoRelativePath(projectDir, filePath),
        ],
        {
          cwd: projectDir,
          env: withProtectedGitBareRepositoryEnv(),
          stdio: "ignore",
        },
      );
      return true;
    } catch {
      return false;
    }
  });
  if (stageablePaths.length > 0) {
    stageRepoPaths(projectDir, stageablePaths);
  }
  return stageablePaths;
}

export function writeAndStageRepoMarkdownFile(args: {
  projectDir: string;
  rootDir: string;
  filePath: string;
  content: string;
}): void {
  writeVerifiedRepoMarkdownFile(args);
  stageRepoPaths(args.projectDir, [args.filePath]);
}

export function moveAndStageRepoMarkdownFile(args: {
  projectDir: string;
  sourceRootDir: string;
  sourcePath: string;
  destinationRootDir: string;
  destinationPath: string;
  sourceContent: string;
  destinationContent: string;
  stage: () => void;
}): void {
  moveVerifiedRepoMarkdownFile({
    ...args,
    shouldDeferStaging: shouldDeferRepoTaskStagingToWorkflowHost,
  });
}

export function removeAndStageRepoMarkdownFile(args: {
  projectDir: string;
  rootDir: string;
  filePath: string;
  stage: () => void;
}): void {
  removeVerifiedRepoMarkdownFile({
    ...args,
    shouldDeferStaging: shouldDeferRepoTaskStagingToWorkflowHost,
  });
}
