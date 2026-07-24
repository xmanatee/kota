import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

function relativePathWithin(rootDir: string, filePath: string): string {
  const relativePath = relative(resolve(rootDir), resolve(filePath));
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Repo mutation path must be inside ${rootDir}: ${filePath}`);
  }
  if (!relativePath.endsWith(".md")) {
    throw new Error(`Repo mutation path must name a markdown file: ${filePath}`);
  }
  return relativePath;
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

export function writeAndStageRepoMarkdownFile(args: {
  projectDir: string;
  rootDir: string;
  filePath: string;
  content: string;
}): void {
  relativePathWithin(args.rootDir, args.filePath);
  writeFileSync(args.filePath, args.content, "utf-8");
  stageRepoPaths(args.projectDir, [args.filePath]);
}
