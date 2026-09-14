// This startup boundary and its config decoder depend only on Node builtins:
// package loading may be unavailable during interrupted dependency promotion.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadInstallationPreparation } from "#core/config/preparation-config.js";

export type PreparationPublication = { directory: string; outputs: string[]; previousOutputs: string[] };

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed dependency recovery record");
  return value as Record<string, unknown>;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("Malformed dependency recovery paths");
  return value;
}
function localDirectory(path: string, required = false): void {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if ((!stat && required) || (stat && (!stat.isDirectory() || stat.isSymbolicLink()))) throw new Error(`Unsafe dependency recovery directory: ${path}`);
}
function git(root: string, args: string[]): string {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  return execFileSync("git", ["-c", "safe.bareRepository=explicit", ...args], { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Shared admission for both initial preparation and crash recovery. */
export function assertPreparationOutputs(root: string, outputs: readonly string[]): void {
  for (const output of outputs) {
    if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(output)) throw new Error("Unsafe preparation output path");
    localDirectory(join(root, output));
    if (git(root, ["ls-files", "--", output]) !== "") throw new Error(`Preparation output contains tracked content: ${output}`);
    git(root, ["check-ignore", "--no-index", "--quiet", `${output}/`]);
  }
}

export function recoverPreparedOutputs(root: string, tempDir: string, value: unknown, published: boolean, expectedHead: string, permittedOutputs: readonly string[]): void {
  const transaction = record(value);
  const outputs = strings(transaction.outputs);
  const previousOutputs = strings(transaction.previousOutputs);
  if (typeof transaction.directory !== "string" || !/^publication-dependencies-[A-Za-z0-9]+$/.test(transaction.directory) ||
    outputs.length === 0 || new Set(outputs).size !== outputs.length ||
    outputs.some((output) => !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(output)) ||
    previousOutputs.some((output) => !outputs.includes(output))) throw new Error("Malformed dependency publication recovery state");
  if (outputs.length !== permittedOutputs.length || outputs.some((output) => !permittedOutputs.includes(output))) {
    throw new Error("Dependency recovery outputs differ from trusted preparation policy");
  }
  assertPreparationOutputs(root, outputs);
  if (git(root, ["rev-parse", "HEAD"]) !== expectedHead) throw new Error("Canonical source changed while dependency recovery waited; retry this run");
  const stage = join(tempDir, transaction.directory);
  localDirectory(stage, true);
  localDirectory(join(stage, "next"), true);
  localDirectory(join(stage, "previous"), true);
  for (const output of outputs) {
    localDirectory(join(stage, "next", output));
    localDirectory(join(stage, "previous", output));
    localDirectory(join(root, output));
  }
  if (published) return;
  for (const output of [...outputs].reverse()) {
    const next = join(stage, "next", output);
    const previous = join(stage, "previous", output);
    const canonical = join(root, output);
    if (!existsSync(next)) renameSync(canonical, next);
    if (existsSync(previous)) renameSync(previous, canonical);
    else if (previousOutputs.includes(output) && !existsSync(canonical)) throw new Error(`Cannot restore dependency output ${output}`);
  }
  // Leave the journal and staging intact. RunLifecycle acknowledges recovery;
  // another startup or a crash before acknowledgement safely replays this work.
}

function liveProcess(value: unknown): boolean {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value <= 0) throw new Error("Malformed daemon ownership pid");
  try { process.kill(value, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}

/** Restore the executing installation before tsx, SQLite addons, or CLI imports.
 * Uses the existing run journal, without migrations or a second recovery queue.
 */
export async function recoverPreparationBeforeImports(installationRoot: string, supervisorToken?: string): Promise<void> {
  const installation = realpathSync(installationRoot);
  const stateDir = join(installation, ".kota");
  const databasePath = join(stateDir, "kota.sqlite");
  if (!existsSync(databasePath)) return;
  localDirectory(stateDir, true);
  if (lstatSync(databasePath).isSymbolicLink()) throw new Error("Dependency recovery database cannot be a symlink");
  // An ordinary client must never alter a live publisher's dependencies. A
  // replacement child may act only after the previous child exited and with
  // its live supervisor's reservation token.
  const checkOwner = () => {
    for (const name of ["daemon-control.json", "daemon-instance.lock", "daemon-state.json"]) {
      const path = join(stateDir, name);
      if (!existsSync(path)) continue;
      if (lstatSync(path).isSymbolicLink()) throw new Error("Unsafe daemon ownership file");
      const owner = record(JSON.parse(readFileSync(path, "utf8")));
      if (liveProcess(owner.pid) && !(name === "daemon-instance.lock" && typeof supervisorToken === "string" && supervisorToken.length > 0 && owner.token === supervisorToken)) return false;
    }
    return true;
  };
  if (!checkOwner()) return;
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
    if (!checkOwner()) return;
    if (!database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get()) return;
    const rows = database.prepare("SELECT r.integration_json, r.sandbox_json FROM runs r JOIN scopes s ON s.id = r.scope_id WHERE s.root_path = ? AND r.integration_json IS NOT NULL").all(installation);
    for (const row of rows) {
      if (typeof row.integration_json !== "string") throw new Error("Malformed run integration journal");
      const journal = record(JSON.parse(row.integration_json));
      if (journal.contract !== "run-lifecycle-v1" || journal.phase !== "publishing" || journal.preparation === undefined) continue;
      if (typeof row.sandbox_json !== "string") throw new Error("Dependency recovery sandbox is missing");
      const sandbox = record(JSON.parse(row.sandbox_json));
      if (typeof sandbox.tempDir !== "string") throw new Error("Dependency recovery scratch is missing");
      const runtimeRoot = join(installation, ".kota", "runtime");
      const child = relative(runtimeRoot, resolve(sandbox.tempDir));
      if (child === "" || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error("Dependency recovery scratch escaped its runtime owner");
      for (let path = resolve(sandbox.tempDir); path !== installation; path = resolve(path, "..")) localDirectory(path, true);
      if (typeof journal.publishedHead !== "string" || !/^[a-f0-9]{40,64}$/.test(journal.publishedHead) || typeof journal.integratedFromHead !== "string") throw new Error("Dependency publication heads are missing");
      const head = git(installation, ["rev-parse", "HEAD"]);
      let published = false;
      try { git(installation, ["merge-base", "--is-ancestor", journal.publishedHead, head]); published = true; }
      catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
      if (!published && head !== journal.integratedFromHead) throw new Error("Dependency publication is ambiguous; retained runtime recovery requires attention");
      recoverPreparedOutputs(installation, sandbox.tempDir, journal.preparation, published, head, loadInstallationPreparation(installation)?.outputs ?? []);
    }
  } finally { database.close(); }
}

/** Command scope selects CLI operations, never installation recovery authority. */
export async function recoverPreparationBeforeCliImports(installationRoot: string): Promise<void> {
  await recoverPreparationBeforeImports(installationRoot, process.env.KOTA_DAEMON_SUPERVISOR_TOKEN);
}
