import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { completeRuntimeActivation, failRuntimeActivation, retryRuntimeActivationAfterRepair, runtimeActivationRetryBlocked } from "#core/daemon/daemon-runtime-activation.js";
import type { DaemonState } from "#core/daemon/daemon-state.js";
import { loadDaemonStateFromDisk, saveDaemonStateToDisk } from "#core/daemon/daemon-state-persistence.js";
import { defineWorkflowBlockingOperation, runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { validateRunIntegration } from "#core/workflow/run-integration-policy.js";
import { RunLifecycle } from "#core/workflow/run-lifecycle.js";
import { RunResourceAllocator } from "#core/workflow/run-resources.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";

const port = vi.hoisted(() => ({ installedFixture: "" }));
// Only the subprocess port is controlled. Its install result is a real offline
// pnpm installation; lifecycle, sandbox construction, Git, SQLite, publication,
// worker imports and activation persistence remain their production owners.
vi.mock("#core/workflow/workflow-command.js", async (original) => {
  const actual = await original<typeof import("#core/workflow/workflow-command.js")>();
  return { ...actual, createWorkflowCommandRunner: (options: import("#core/workflow/workflow-command.js").WorkflowCommandRunnerOptions): import("#core/workflow/workflow-command.js").WorkflowCommandRunner => async (input) => {
    const cwd = options.cwd;
    const output = { text: "", totalBytes: 0, truncated: false };
    const identity = { pid: 123, processGroupId: 123, osStartToken: "fixture", observedCommandHash: "fixture" };
    const details = { command: input.command, args: input.args ?? [], cwd, identity, stdout: output, stderr: output };
    if (input.args?.includes("install.mjs")) {
      if (!existsSync(join(cwd, "node_modules/permit-install"))) throw new actual.WorkflowCommandError("failed", "Local package cache must be prepared", { ...details, exitCode: 1, signal: null });
      cpSync(join(port.installedFixture, "node_modules"), join(cwd, "node_modules"), { recursive: true, verbatimSymlinks: true });
      appendFileSync(join(cwd, "node_modules/install-count"), "installed\n");
    } else if (input.args?.includes("check.mjs")) {
      const expected = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).dependencies["fixture-dependency"];
      const installed = join(cwd, "node_modules/fixture-dependency/package.json");
      if (!existsSync(installed) || JSON.parse(readFileSync(installed, "utf8")).version !== `${expected.endsWith("v2") ? 2 : 1}.0.0`) {
        throw new actual.WorkflowCommandError("failed", "Locked dependency is not installed", { ...details, exitCode: 1, signal: null });
      }
    } else throw new Error("Unexpected fixture command");
    return { ...details, exitCode: 0 };
  } };
});

const roots: string[] = [];
const stores: RunStateDatabase[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function write(root: string, path: string, value: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value);
}
function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function commit(root: string): string {
  git(root, "add", "-A");
  git(root, "commit", "-qm", "fixture revision");
  return git(root, "rev-parse", "HEAD");
}
function selectDependency(root: string, version: number): void {
  write(root, "package.json", JSON.stringify({ name: "preparation-consumer", type: "module", packageManager: "pnpm@10.32.1", dependencies: { "fixture-dependency": `file:vendor/v${version}` } }));
  execFileSync("pnpm", ["install", "--lockfile-only", "--offline", "--ignore-scripts", "--store-dir", "node_modules/.store"], { cwd: root, stdio: "pipe" });
  write(root, "runtime.mjs", `import { value } from 'fixture-dependency/${version === 1 ? "old" : "new"}.js'; export function run() { return value; }`);
}

// Distinct failure: a real locked install must reach both the reconciled writer
// and canonical imports before a draining sibling starts its next worker.
test("prepares a moved writer, retains failed setup, publishes usable dependencies, and verifies activation retry", async () => {
  const root = mkdtempSync(join(tmpdir(), "kota-dependency-journey-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "KOTA Test");
  git(root, "config", "user.email", "kota@example.test");
  git(root, "config", "commit.gpgsign", "false");
  write(root, ".gitignore", ".kota/\nnode_modules/\n");
  write(root, "pnpm-workspace.yaml", "dangerouslyAllowAllBuilds: false\n");
  for (const version of [1, 2]) {
    write(root, `vendor/v${version}/package.json`, JSON.stringify({ name: "fixture-dependency", version: `${version}.0.0`, type: "module", scripts: { install: "node -e \"require('fs').writeFileSync('lifecycle-ran', 'unsafe')\"" } }));
    write(root, `vendor/v${version}/${version === 1 ? "old" : "new"}.js`, `export const value = ${version};`);
  }
  write(root, "check.mjs", `
    import { readFileSync } from 'node:fs';
    const pkg = JSON.parse(readFileSync('package.json'));
    const expected = JSON.parse(readFileSync(pkg.dependencies['fixture-dependency'].slice(5) + '/package.json'));
    const actual = JSON.parse(readFileSync('node_modules/fixture-dependency/package.json'));
    if (actual.version !== expected.version) throw new Error('Locked dependency is not installed');
    const runtime = await import('./runtime.mjs');
    if (runtime.run() !== Number(expected.version[0])) throw new Error('Wrong runtime');
  `);
  write(root, "install.mjs", `
    import { existsSync, appendFileSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
    if (!existsSync('node_modules/permit-install')) throw new Error('Local package cache must be prepared');
    const result = spawnSync('pnpm', ['install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--store-dir', 'node_modules/.store'], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
    appendFileSync('node_modules/install-count', 'installed\\n');
  `);
  selectDependency(root, 1);
  execFileSync("pnpm", ["install", "--offline", "--frozen-lockfile", "--ignore-scripts", "--store-dir", "node_modules/.store"], { cwd: root, stdio: "pipe" });
  const originalHead = commit(root);
  port.installedFixture = join(root, ".kota", "prepared-package");
  cpSync(join(root, "vendor"), join(port.installedFixture, "vendor"), { recursive: true });
  write(port.installedFixture, "pnpm-workspace.yaml", "dangerouslyAllowAllBuilds: false\n");
  selectDependency(port.installedFixture, 2);
  execFileSync("pnpm", ["install", "--offline", "--frozen-lockfile", "--ignore-scripts", "--store-dir", "node_modules/.store"], { cwd: port.installedFixture, stdio: "pipe" });
  const preparation = { inputs: ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"], outputs: ["node_modules"], command: ["node", "install.mjs"], checkCommand: ["node", "check.mjs"] };
  const authorityConfigPath = join(root, ".kota", "authority.json");
  write(root, ".kota/authority.json", JSON.stringify({ trustedScopes: [root] }));
  write(root, ".kota/config.json", JSON.stringify({ workflow: { preparation } }));
  const store = new RunStateDatabase(join(root, ".kota", "state"));
  stores.push(store);
  const now = () => new Date().toISOString();
  store.registerScope({ id: "project", rootPath: root, createdAt: now() });
  const { epoch } = store.beginDaemonSession(now());
  store.admitRun({ id: "dependency-change", scopeId: "project", workflow: "fixture", repository: "write", trigger: { event: "manual", schemaRef: null, payload: {} }, resources: ["task:dependency-change"], admittedAt: now() });
  store.startRun("dependency-change", epoch, now());
  let builds = 0;
  const repair = vi.fn(async () => { throw new Error("Setup must not enter agent repair"); });
  const lifecycle = new RunLifecycle({
    authorityConfigPath, store, daemonEpoch: epoch,
    createResourceAllocator: (database) => new RunResourceAllocator(database, { portStart: 41000, portEnd: 41003, portRangeSize: 4, isPortAvailable: async () => true }),
    executeWorkflow: async (context) => {
      builds++;
      selectDependency(context.sandbox.workspaceDir, 2);
      write(root, "sibling.txt", "canonical moved while the builder worked");
      commit(root);
      return { kind: "completed", commitMessage: "Use new locked dependency" };
    },
    validate: (context, input) => validateRunIntegration(context, { validationCommand: ["node", "check.mjs"] }, input, authorityConfigPath),
    continueIntegration: repair,
  });
  const signal = new AbortController().signal;
  const failed = await lifecycle.execute(store.getRun("dependency-change")!, signal);
  expect(failed).toMatchObject({ kind: "suspended", state: "needs_attention", wait: { reason: "repository-preparation-failed" } });
  expect(repair).not.toHaveBeenCalled();
  const retained = store.getRun("dependency-change")!;
  const writer = retained.sandbox!.workspaceDir;
  expect(readFileSync(join(writer, "sibling.txt"), "utf8")).toContain("canonical moved");
  expect(git(root, "rev-parse", "HEAD")).not.toBe(originalHead);
  expect(execFileSync("node", ["check.mjs"], { cwd: root, stdio: "pipe" })).toEqual(Buffer.alloc(0));
  if (failed.kind !== "suspended") throw new Error("Expected retained setup failure");
  store.suspendRun({ runId: retained.id, epoch, state: failed.state, wait: failed.wait, suspendedAt: now() });
  write(writer, "node_modules/permit-install", "cache repaired");
  store.resumeRun(retained.id, now());
  store.startRun(retained.id, epoch, now());
  const resumed = await lifecycle.execute(store.getRun(retained.id)!, signal);
  expect(resumed).toEqual({ kind: "terminal", state: "succeeded" });
  expect(builds).toBe(1);
  expect(store.getRun(retained.id)?.sandbox).toBeUndefined();
  expect(readFileSync(join(root, "node_modules/install-count"), "utf8")).toBe("installed\n");
  expect(existsSync(join(root, "node_modules/fixture-dependency/lifecycle-ran"))).toBe(false);
  const worker = defineWorkflowBlockingOperation<null, number>(pathToFileURL(join(root, "runtime.mjs")).href, "run");
  expect(await runWorkflowBlockingOperation(worker, null)).toBe(2);

  const head = git(root, "rev-parse", "HEAD");
  const candidate = { root, mode: "source" as const, loadedRevision: head };
  const state: DaemonState = { pid: process.pid, startedAt: now(), runtimeRevision: { ...candidate, canonicalRevision: head, activation: { status: "failed", targetRevision: head, error: "Prior missing dependency diagnostic" } } };
  const stateDir = join(root, ".kota");
  saveDaemonStateToDisk(stateDir, state);
  expect(runtimeActivationRetryBlocked(state.runtimeRevision, candidate)).toBe(true);
  await retryRuntimeActivationAfterRepair(state, stateDir, candidate, signal, authorityConfigPath);
  expect(state.runtimeRevision?.activation).toMatchObject({ status: "starting", error: "Prior missing dependency diagnostic" });
  completeRuntimeActivation(state, stateDir);
  expect(loadDaemonStateFromDisk(stateDir)?.runtimeRevision?.activation?.status).toBe("active");
  state.runtimeRevision!.activation!.status = "starting";
  failRuntimeActivation(state, stateDir, "Second startup failed");
  expect(runtimeActivationRetryBlocked(state.runtimeRevision, candidate)).toBe(true);
  rmSync(join(root, "node_modules/fixture-dependency"));
  await expect(retryRuntimeActivationAfterRepair(state, stateDir, candidate, signal, authorityConfigPath)).rejects.toThrow("Dependency preparation failed");
  expect(loadDaemonStateFromDisk(stateDir)?.runtimeRevision?.activation).toMatchObject({ status: "failed", error: "Second startup failed" });
}, 60_000);
