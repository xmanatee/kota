
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { installExternalCallShims } from "./external-call-shim.js";
import type {
  FixtureRoundTaskInput,
  LoadedFixture,
  VerifierCalibrationSetupOperation,
} from "./fixture.js";
import type { FixtureRunExecutionMode } from "./fixture-run.js";
import { applyFixtureTemplates } from "./fixture-templating.js";
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
function applySetupOperation(params: {
  fixtureDir: string;
  workingDir: string;
  operation: VerifierCalibrationSetupOperation;
  sourceLabel: string;
  targetLabel: string;
}): void {
  const source = relativePathInside(
    params.fixtureDir,
    params.operation.sourcePath,
    params.sourceLabel,
  );
  const target = relativePathInside(
    params.workingDir,
    params.operation.targetPath,
    params.targetLabel,
  );
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(
      `${params.sourceLabel} ${params.operation.sourcePath} must reference an existing fixture file.`,
    );
  }
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
}

export function materializeFixtureWorkingDirAt(params: {
  fixture: LoadedFixture;
  workingDir: string;
  setup?: readonly VerifierCalibrationSetupOperation[];
}): {
  workingDir: string;
  shimDir: string | null;
} {
  const { fixture, workingDir } = params;
  mkdirSync(workingDir, { recursive: true });
  cpSync(fixture.initialStateDir, workingDir, { recursive: true });
  // Rewrite `{{NOW_MINUS_HOURS:N}}` / `{{NOW_MINUS_MINUTES:N}}` placeholders so
  // fixtures that depend on a sliding time window (e.g. improver reading a
  // "failed in the last 24h" run under .kota/runs/) stay deterministic
  // without a second setup surface. No-op for fixtures without templates.
  applyFixtureTemplates(workingDir, Date.now());
  for (const operation of params.setup ?? []) {
    applySetupOperation({
      fixtureDir: fixture.fixtureDir,
      workingDir,
      operation,
      sourceLabel: "variant setup sourcePath",
      targetLabel: "variant setup targetPath",
    });
  }
  initFixtureGit(workingDir);
  let shimDir: string | null = null;
  if (
    fixture.spec.externalCallShims !== undefined &&
    fixture.spec.externalCallShims.length > 0
  ) {
    const installed = installExternalCallShims(
      workingDir,
      fixture.spec.externalCallShims,
    );
    shimDir = installed.shimDir;
  }
  return { workingDir, shimDir };
}

export function materializeFixtureWorkingDir(fixture: LoadedFixture): {
  workingDir: string;
  shimDir: string | null;
} {
  return materializeFixtureWorkingDirAt({
    fixture,
    workingDir: mkdtempSync(join(tmpdir(), `kota-eval-${fixture.spec.id}-`)),
  });
}

export function fixtureExecutionMode(fixture: LoadedFixture): FixtureRunExecutionMode {
  return fixture.agentStepRecordings.length > 0 ? "replay" : "live";
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

export function resolveSkillAblationVariantWorkingDir(
  parentWorkingDir: string,
  variantId: string,
): string {
  return relativePathInside(
    parentWorkingDir,
    variantId,
    `skill-ablation variant "${variantId}" working directory`,
  );
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
      mkdirSync(dirname(target), { recursive: true });
      cpSync(source, target);
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
