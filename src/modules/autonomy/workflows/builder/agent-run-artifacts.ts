import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { isBuilderPathInside } from "./workspace.js";

const REQUIRED_AGENT_RUN_ARTIFACTS = [
  "success-criteria.txt",
  "success-criteria-verified.txt",
  "commit-message.txt",
] as const;

function assertStageable(workspaceDir: string, filePath: string): void {
  const workspaceRoot = resolve(workspaceDir);
  const resolvedFile = resolve(filePath);
  if (!isBuilderPathInside(workspaceRoot, resolvedFile)) {
    throw new Error(`Agent run artifact is outside the active workspace: ${filePath}`);
  }

  const rel = relative(workspaceRoot, resolvedFile);
  const result = spawnSync("git", ["add", "--dry-run", "-A", "--", rel], {
    cwd: workspaceRoot,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr]
      .filter((text) => text.length > 0)
      .join("\n")
      .trim();
    throw new Error(
      `Required agent run artifact is not stageable: ${rel}\n${detail}`,
    );
  }
}

export function checkAgentRunArtifactsStageable(
  agentRunDir: string,
  workspaceDir: string,
): string {
  const missing = REQUIRED_AGENT_RUN_ARTIFACTS
    .map((name) => join(agentRunDir, name))
    .filter((filePath) => !existsSync(filePath));
  if (missing.length > 0) {
    throw new Error(
      `Required agent run artifact(s) are missing:\n${missing.map((p) => `  ${p}`).join("\n")}`,
    );
  }

  for (const name of REQUIRED_AGENT_RUN_ARTIFACTS) {
    assertStageable(workspaceDir, join(agentRunDir, name));
  }
  return `OK: ${REQUIRED_AGENT_RUN_ARTIFACTS.length} agent run artifact(s) stageable`;
}
