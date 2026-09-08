
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type {
  FixtureRoundTaskInput,
  LoadedFixture,
} from "./fixture.js";
import { ROUND_INPUT_WRITER_SOURCE } from "./round-input-writer-source.js";
import type { WorkflowExecutionRequest } from "./runner-types.js";

function runGitSync(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr]
      .filter((s) => s && s.length > 0)
      .join("\n")
      .trim();
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}${detail ? `: ${detail}` : ""}`,
    );
  }
}

function restoreFixtureIgnoreFiles(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      restoreFixtureIgnoreFiles(path);
    } else if (entry.isFile() && entry.name === "fixture.gitignore") {
      renameSync(path, join(directory, ".gitignore"));
    }
  }
}

/** Copy the canonical, package-safe fixture tree into its executable shape. */
export function copyFixtureInitialState(
  initialStateDir: string,
  workingDir: string,
): void {
  cpSync(initialStateDir, workingDir, { recursive: true });
  restoreFixtureIgnoreFiles(workingDir);
}

/**
 * Initialize a git repo inside the fixture working directory so workflows
 * whose steps shell out to git (writeScope enforcement, commit step) see
 * a coherent repo. Seeds an initial commit of the fixture's `initial/`
 * tree so every later mutation shows up as a proper diff against HEAD,
 * matching how workflows inspect state in a real repo.
 */
function initFixtureGit(workingDir: string): void {
  runGitSync(workingDir, ["init", "--quiet", "--initial-branch=main"]);
  runGitSync(workingDir, ["config", "user.email", "eval-harness@kota.local"]);
  runGitSync(workingDir, ["config", "user.name", "KOTA Eval Harness"]);
  runGitSync(workingDir, ["config", "commit.gpgsign", "false"]);
  runGitSync(workingDir, ["add", "-A"]);
  // `git commit` refuses an empty tree; fixtures always seed at least
  // `initial/…`, but allow an empty commit just in case so the invariant
  // "HEAD exists" holds universally for later diffs.
  runGitSync(workingDir, [
    "commit",
    "--allow-empty",
    "-m",
    "eval-harness fixture initial state",
    "--quiet",
  ]);
}

/**
 * Materialize the fixture's initial state into a fresh working directory.
 * The directory is created under the OS tmp dir by default so harness runs
 * never mutate the operator's repo even if something misbehaves.
 */
export function materializeFixtureWorkingDir(fixture: LoadedFixture): {
  workingDir: string;
} {
  const workingDir = mkdtempSync(join(tmpdir(), `kota-eval-${fixture.spec.id}-`));
  copyFixtureInitialState(fixture.initialStateDir, workingDir);
  initFixtureGit(workingDir);
  return { workingDir };
}

export function relativePathInside(root: string, relativePath: string, label: string): string {
  if (relativePath.length === 0 || isAbsolute(relativePath)) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  const absoluteRoot = resolve(root);
  const resolved = resolve(absoluteRoot, relativePath);
  const rootWithSep = absoluteRoot.endsWith(sep)
    ? absoluteRoot
    : `${absoluteRoot}${sep}`;
  if (resolved !== absoluteRoot && !resolved.startsWith(rootWithSep)) {
    throw new Error(`${label} must stay inside ${absoluteRoot}; got ${relativePath}.`);
  }
  if (resolved === absoluteRoot) {
    throw new Error(`${label} must point at a file below ${absoluteRoot}.`);
  }
  return resolved;
}

export function applyRoundTaskInput(
  taskInput: FixtureRoundTaskInput,
  fixtureDir: string,
  workingDir: string,
): WorkflowExecutionRequest["triggerPayload"] | undefined {
  switch (taskInput.kind) {
    case "initial-state":
      return undefined;
    case "trigger-payload":
      return taskInput.payload;
    case "copy-fixture-file": {
      const source = relativePathInside(
        fixtureDir,
        taskInput.sourcePath,
        "round taskInput.sourcePath",
      );
      const target = relativePathInside(
        workingDir,
        taskInput.targetPath,
        "round taskInput.targetPath",
      );
      if (!existsSync(source) || !statSync(source).isFile()) {
        throw new Error(
          `round taskInput.sourcePath ${taskInput.sourcePath} must reference an existing fixture file.`,
        );
      }
      const result = spawnSync(process.execPath, [
        "--input-type=module", "-e", ROUND_INPUT_WRITER_SOURCE,
        resolve(workingDir), relative(resolve(workingDir), target),
        String(statSync(source).mode & 0o777),
      ], {
        // Do not load candidate-controlled Node startup hooks or config.
        env: {},
        cwd: tmpdir(),
        input: readFileSync(source),
        encoding: "utf8",
        timeout: 30_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (result.error !== undefined || result.status !== 0) {
        throw new Error(result.error?.message ?? (result.stderr.trim() || "Round input copy failed."));
      }
      return undefined;
    }
  }
}

/**
 * Clean up a fixture run's working directory. Callers control when this
 * happens so post-run debugging (inspecting files the agent produced) stays
 * possible in failing CI.
 */
export function cleanupFixtureWorkingDir(workingDir: string): void {
  rmSync(workingDir, { recursive: true, force: true });
}
