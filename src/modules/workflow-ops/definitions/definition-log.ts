import { execSync } from "node:child_process";
import { resolve } from "node:path";
import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { getWorkflowDefinitions } from "../definitions-source.js";

function runGit(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, {
      encoding: "utf-8",
      env: withProtectedGitBareRepositoryEnv(),
      stdio: "pipe",
      cwd,
    });
  } catch {
    return "";
  }
}

function getGitRoot(cwd: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      env: withProtectedGitBareRepositoryEnv(),
      stdio: "pipe",
      cwd,
    }).trim();
  } catch {
    return null;
  }
}

export function registerDefinitionLogCommand(
  wfCmd: Command,
  ctx: ModuleContext,
): void {
  wfCmd
    .command("definition-log <workflow-name>")
    .description("Show git commit history for a workflow's definition file")
    .option("--diff", "Show the file diff for each commit")
    .action((workflowName: string, opts: { diff?: boolean }) => {
      const definitions = getWorkflowDefinitions(ctx);
      const def = definitions.find((d) => d.name === workflowName);
      if (!def) {
        const names = definitions.map((d) => d.name).join(", ");
        console.error(`Unknown workflow "${workflowName}". Known: ${names}`);
        process.exit(1);
      }

      const projectDir = process.cwd();
      const gitRoot = getGitRoot(projectDir);
      if (!gitRoot) {
        console.log("Not a git repository. Cannot show definition history.");
        return;
      }

      const defPath = resolve(projectDir, def.definitionPath);

      const checkOutput = runGit(`ls-files -- "${defPath}"`, gitRoot);
      if (!checkOutput.trim()) {
        console.log(
          `Definition file "${def.definitionPath}" is not tracked by git. No history available.`,
        );
        return;
      }

      if (opts.diff) {
        const output = runGit(
          `log --patch --pretty=format:"%h %ad %s" --date=short -- "${defPath}"`,
          gitRoot,
        );
        if (!output.trim()) {
          console.log(`No commits found for "${def.definitionPath}".`);
          return;
        }
        console.log(output);
      } else {
        const output = runGit(
          `log --pretty=format:"%h %ad %s" --date=short -- "${defPath}"`,
          gitRoot,
        );
        if (!output.trim()) {
          console.log(`No commits found for "${def.definitionPath}".`);
          return;
        }
        console.log(`Definition history for workflow "${def.name}" (${def.definitionPath}):\n`);
        console.log(output);
      }
    });
}
