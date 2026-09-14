import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { cp, lstat, mkdtemp, readdir, readlink, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { buildNativeCliEnvironment } from "#core/agent-harness/native-cli-environment.js";
import { withNativeCliSandbox } from "#core/agent-harness/native-cli-sandbox.js";
import { type KotaConfig, loadConfig } from "#core/config/config.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { withBlockingWorkersDrained } from "./blocking-operation.js";
import { PublicationInvariantError } from "./integration-queue.js";
import { assertPreparationOutputs, type PreparationPublication, recoverPreparedOutputs } from "./repository-preparation-recovery.js";
import type { RunContext } from "./run-context.js";
import { createWorkflowCommandRunner, WorkflowCommandError } from "./workflow-command.js";

export type RepositoryPreparation = NonNullable<NonNullable<KotaConfig["workflow"]>["preparation"]>;
export type { PreparationPublication } from "./repository-preparation-recovery.js";

export class RepositoryPreparationError extends Error {
  constructor(root: string, cause: unknown) {
    const detail = cause instanceof WorkflowCommandError
      ? `${cause.kind} (exit ${cause.exitCode ?? "unavailable"}): ${cause.stderr.text || cause.stdout.text || cause.message}`
      : cause instanceof Error ? cause.message : String(cause);
    super(`Dependency preparation failed in ${root}. Repair the project setup or package cache, then retry this run: ${detail.slice(-12_000)}`, { cause });
    this.name = "RepositoryPreparationError";
  }
}

export function projectPreparation(scopeRoot: string, authorityConfigPath?: string): RepositoryPreparation | undefined {
  try { return loadConfig(scopeRoot, undefined, { globalConfigPath: authorityConfigPath }).workflow?.preparation; }
  catch (error) { throw new RepositoryPreparationError(scopeRoot, error); }
}

function fingerprint(root: string, policy: RepositoryPreparation): string {
  const hash = createHash("sha256");
  for (const path of policy.inputs) {
    const absolute = join(root, path);
    // Inputs cannot borrow files from outside the selected checkout.
    for (let parent = absolute; parent !== root; parent = resolve(parent, "..")) {
      if (lstatSync(parent).isSymbolicLink()) throw new Error(`Preparation input is a symlink: ${path}`);
    }
    hash.update(path).update("\0").update(readFileSync(absolute)).update("\0");
  }
  return hash.digest("hex");
}

function outputPaths(root: string, policy: RepositoryPreparation): string[] {
  assertPreparationOutputs(root, policy.outputs);
  return policy.outputs.map((output) => join(root, output));
}

type PreparationOptions = {
  root: string;
  scopeRoot: string;
  policy: RepositoryPreparation;
  signal: AbortSignal;
  authorityConfigPath?: string;
  context?: RunContext;
};

async function command(options: PreparationOptions, check: boolean): Promise<void> {
  const { root, scopeRoot, policy, context, signal, authorityConfigPath } = options;
  const [executable, ...args] = check ? policy.checkCommand : policy.command;
  const outputs = outputPaths(root, policy);
  if (!check) for (const path of outputs) mkdirSync(path, { recursive: true });
  const runner = createWorkflowCommandRunner({ cwd: root, signal, onProcessSpawn: context?.processes.register });
  await withNativeCliSandbox(executable, args, {
    cwd: root,
    scopeRoot,
    authorityConfigPath,
    machineAuthorityOwner: "kota",
    runtimeStateRoot: join(scopeRoot, ".kota"),
    writableRoots: check ? [] : outputs,
    runtimeWritableRoots: context ? [context.resources.tempDir, context.resources.agentDir, context.resources.artifactDir] : [],
    env: buildNativeCliEnvironment({ overrides: context?.resources.env }),
    allowedEgressHosts: check ? [] : policy.allowedEgressHosts ?? [],
  }, (launch) => runner({ ...launch, envMode: "replace", timeoutMs: 600_000 }));
}

/** A successful setup command is insufficient: the project's readiness probe must pass. */
export async function prepareRepository(options: PreparationOptions, checkOnly = false): Promise<void> {
  try {
    const before = fingerprint(options.root, options.policy);
    try { await command(options, true); }
    catch (error) {
      options.signal.throwIfAborted();
      if (checkOnly || !(error instanceof WorkflowCommandError) || error.kind !== "failed") throw error;
      await command(options, false);
      await command(options, true);
    }
    if (fingerprint(options.root, options.policy) !== before) throw new Error("Preparation changed its locked inputs");
  } catch (error) {
    options.signal.throwIfAborted();
    throw new RepositoryPreparationError(options.root, error);
  }
}

export async function prepareRunRepository(context: RunContext, authorityConfigPath?: string): Promise<void> {
  const policy = projectPreparation(context.scope.root, authorityConfigPath);
  if (!policy) return;
  try {
    const writer = context.sandbox.workspaceDir;
    outputPaths(writer, policy);
    outputPaths(context.scope.root, policy);
    // Copy installed bytes, never shared writable directories. Package managers
    // may recreate them; only the readiness probe establishes usable builds.
    for (const output of policy.outputs) {
      const source = join(context.scope.root, output);
      const target = join(writer, output);
      if (existsSync(source) && (!existsSync(target) || (await readdir(target)).length === 0)) {
        await verifyRelocatable(source, context.scope.root, policy.outputs);
        await cp(source, target, { recursive: true, verbatimSymlinks: true });
      }
    }
    await prepareRepository({ root: writer, scopeRoot: context.scope.root, policy, signal: context.signal, authorityConfigPath, context });
  } catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof RepositoryPreparationError) throw error;
    throw new RepositoryPreparationError(context.sandbox.workspaceDir, error);
  }
}

async function verifyRelocatable(path: string, root: string, outputs: readonly string[]): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) {
    const link = await readlink(path);
    const target = resolve(path, "..", link);
    if (isAbsolute(link) || !outputs.some((output) => {
      const child = relative(join(root, output), target);
      return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
    })) throw new Error(`Preparation output has a non-relocatable link: ${path}`);
  } else if (stat.isDirectory()) {
    for (const child of await readdir(path)) await verifyRelocatable(join(path, child), root, outputs);
  } else if (!stat.isFile()) throw new Error(`Preparation output contains a special file: ${path}`);
}

/** Stage without host execution; replace ignored outputs and source in one worker-free turn. */
export async function publishPreparedRepository(
  context: RunContext,
  publish: () => void,
  authorityConfigPath: string | undefined,
  persistPreparation: (value: PreparationPublication | undefined) => void,
): Promise<void> {
  const root = context.scope.root;
  const writer = context.sandbox.workspaceDir;
  const policy = projectPreparation(root, authorityConfigPath);
  if (!policy) { publish(); return; }
  let staging: string | undefined;
  let recoverable = false;
  try {
    const canonicalInputs = fingerprint(root, policy);
    const writerInputs = fingerprint(writer, policy);
    if (canonicalInputs === writerInputs) {
      try {
        await prepareRepository({ root, scopeRoot: root, policy, signal: context.signal, authorityConfigPath }, true);
        publish();
        return;
      } catch (error) {
        if (!(error instanceof RepositoryPreparationError)) throw error;
      }
    }
    outputPaths(root, policy);
    outputPaths(writer, policy);
    await prepareRepository({ root: writer, scopeRoot: root, policy, signal: context.signal, context, authorityConfigPath }, true);
    staging = await mkdtemp(join(context.resources.tempDir, "publication-dependencies-"));
    mkdirSync(join(staging, "next"));
    mkdirSync(join(staging, "previous"));
    for (const output of policy.outputs) {
      await verifyRelocatable(join(writer, output), writer, policy.outputs);
      await cp(join(writer, output), join(staging, "next", output), { recursive: true, verbatimSymlinks: true });
    }
    const stage = staging;
    await withBlockingWorkersDrained(() => {
      context.signal.throwIfAborted();
      if (fingerprint(root, policy) !== canonicalInputs || fingerprint(writer, policy) !== writerInputs) {
        throw new Error("Preparation inputs changed before publication");
      }
      outputPaths(root, policy);
      // Persistence may fail after committing its write; retain staging on ambiguity.
      recoverable = true;
      persistPreparation({ directory: relative(context.resources.tempDir, stage), outputs: [...policy.outputs], previousOutputs: policy.outputs.filter((output) => existsSync(join(root, output))) });
      const installed: string[] = [];
      const saved: string[] = [];
      try {
        for (const output of policy.outputs) {
          if (existsSync(join(root, output))) {
            renameSync(join(root, output), join(stage, "previous", output));
            saved.push(output);
          }
          renameSync(join(stage, "next", output), join(root, output));
          installed.push(output);
        }
        publish();
      } catch (error) {
        // A Git command may fail after moving its ref. Keep the new environment
        // and let the publication journal decide that ambiguous effect on retry.
        const head = (cwd: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd, env: withProtectedGitBareRepositoryEnv(), encoding: "utf8" });
        if (head(root) === head(writer)) throw error;
        for (const output of installed.reverse()) renameSync(join(root, output), join(stage, "next", output));
        for (const output of saved.reverse()) renameSync(join(stage, "previous", output), join(root, output));
        persistPreparation(undefined);
        recoverable = false;
        throw error;
      }
      persistPreparation(undefined);
      recoverable = false;
    }, context.signal);
  } catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof PublicationInvariantError) throw error;
    throw new RepositoryPreparationError(root, error);
  } finally {
    if (staging && !recoverable) await rm(staging, { recursive: true, force: true });
  }
}

/** Live recovery shares the dependency-free bootstrap implementation. */
export async function recoverPreparedPublication(context: { scope: { root: string }; resources: { tempDir: string }; signal: AbortSignal }, transaction: PreparationPublication, published: boolean, expectedHead: string, authorityConfigPath?: string): Promise<void> {
  try {
    await withBlockingWorkersDrained(() => recoverPreparedOutputs(context.scope.root, context.resources.tempDir, transaction, published, expectedHead, projectPreparation(context.scope.root, authorityConfigPath)?.outputs ?? []), context.signal);
  } catch (error) {
    context.signal.throwIfAborted();
    throw new RepositoryPreparationError(context.scope.root, error);
  }
}
