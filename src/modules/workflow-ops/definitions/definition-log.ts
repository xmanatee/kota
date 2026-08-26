import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { printWorkflowError, printWorkflowText } from "../cli-output.js";
import { getWorkflowDefinitions } from "../definitions-source.js";

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER_BYTES = 1024 * 1024;

function runGit(args: readonly string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      encoding: "utf-8",
      env: withProtectedGitBareRepositoryEnv(),
      stdio: "pipe",
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER_BYTES,
    });
  } catch {
    return "";
  }
}

function getGitRoot(cwd: string): string | null {
  return runGit(["rev-parse", "--show-toplevel"], cwd).trim() || null;
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
        printWorkflowError(`Unknown workflow "${workflowName}". Known: ${names}`);
        process.exit(1);
      }

      const workspaceRoot = process.cwd();
      const gitRoot = getGitRoot(workspaceRoot);
      if (!gitRoot) {
        printWorkflowText("Not a git repository. Cannot show definition history.");
        return;
      }

      const defPath = resolve(workspaceRoot, def.definitionPath);

      const checkOutput = runGit(["ls-files", "--", defPath], gitRoot);
      if (!checkOutput.trim()) {
        printWorkflowText(
          `Definition file "${def.definitionPath}" is not tracked by git. No history available.`,
        );
        return;
      }

      if (opts.diff) {
        const output = runGit(
          [
            "log",
            "--patch",
            "--pretty=format:%h %ad %s",
            "--date=short",
            "--",
            defPath,
          ],
          gitRoot,
        );
        if (!output.trim()) {
          printWorkflowText(`No commits found for "${def.definitionPath}".`);
          return;
        }
        printWorkflowText(output);
      } else {
        const output = runGit(
          [
            "log",
            "--pretty=format:%h %ad %s",
            "--date=short",
            "--",
            defPath,
          ],
          gitRoot,
        );
        if (!output.trim()) {
          printWorkflowText(`No commits found for "${def.definitionPath}".`);
          return;
        }
        printWorkflowText(`Definition history for workflow "${def.name}" (${def.definitionPath}):\n`);
        printWorkflowText(output);
      }
    });
}
