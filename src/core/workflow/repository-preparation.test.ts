import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { recoverPreparedPublication } from "./repository-preparation.js";
import { RunSandboxManager } from "./run-sandbox.js";
import { RunStateDatabase } from "./run-state-database.js";

test("recovers interrupted dependency promotion before or after publication and tolerates replay", async () => {
  const root = mkdtempSync(join(tmpdir(), "kota-preparation-recovery-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "fixture"], { cwd: root });
  writeFileSync(join(root, ".gitignore"), "packages/\ntemp/\n");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const context = { scope: { root }, resources: { tempDir: join(root, "temp") }, signal: new AbortController().signal };
  const authorityConfigPath = join(root, "authority.json");
  writeFileSync(authorityConfigPath, JSON.stringify({ workflow: { preparation: { command: ["node"], checkCommand: ["node"], inputs: ["package.json"], outputs: ["packages"] } } }));
  const transaction = { directory: "publication-dependencies-fixture", outputs: ["packages"], previousOutputs: ["packages"] };
  const stage = join(context.resources.tempDir, transaction.directory);
  const canonical = join(root, "packages");
  const next = join(stage, "next", "packages");
  const previous = join(stage, "previous", "packages");
  try {
    mkdirSync(canonical); writeFileSync(join(canonical, "version"), "old");
    mkdirSync(next, { recursive: true }); writeFileSync(join(next, "version"), "new");
    mkdirSync(join(stage, "previous"));
    // Crash after saving old packages, before installing new ones.
    renameSync(canonical, previous);
    await recoverPreparedPublication(context, transaction, false, head, authorityConfigPath);
    await recoverPreparedPublication(context, transaction, false, head, authorityConfigPath);
    expect(readFileSync(join(canonical, "version"), "utf8")).toBe("old");
    // Crash after installing packages but before publishing source.
    renameSync(canonical, previous); renameSync(next, canonical);
    await recoverPreparedPublication(context, transaction, false, head, authorityConfigPath);
    await recoverPreparedPublication(context, transaction, false, head, authorityConfigPath);
    expect(readFileSync(join(canonical, "version"), "utf8")).toBe("old");
    // Once source published, replay must keep its matching packages.
    renameSync(canonical, previous); renameSync(next, canonical);
    await recoverPreparedPublication(context, transaction, true, head, authorityConfigPath);
    await recoverPreparedPublication(context, transaction, true, head, authorityConfigPath);
    expect(readFileSync(join(canonical, "version"), "utf8")).toBe("new");
    // A replaced staging parent cannot redirect runtime-owned renames.
    rmSync(join(stage, "next"), { recursive: true });
    symlinkSync(root, join(stage, "next"));
    await expect(recoverPreparedPublication(context, transaction, false, head, authorityConfigPath)).rejects.toThrow("Unsafe dependency recovery directory");
    expect(readFileSync(join(canonical, "version"), "utf8")).toBe("new");
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test("a fresh Node bootstrap restores missing packages from the durable journal before importing its runtime", async () => {
  const root = mkdtempSync(join(tmpdir(), "kota-bootstrap-recovery-"));
  const stateDir = join(root, ".kota");
  const foreignRoot = mkdtempSync(join(tmpdir(), "kota-foreign-recovery-"));
  const foreignStore = new RunStateDatabase(join(foreignRoot, ".kota"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test"); git("config", "user.email", "test@example.test"); git("config", "commit.gpgsign", "false");
  writeFileSync(join(root, ".gitignore"), ".kota/\nnode_modules/\ncache/\n");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "index.ts"), "original source");
  writeFileSync(join(root, "runtime.mjs"), "import value from 'boot-dependency'; console.log(value);");
  git("add", "-A"); git("commit", "-qm", "old runtime");
  const head = git("rev-parse", "HEAD");
  const store = new RunStateDatabase(stateDir);
  const now = new Date().toISOString();
  try {
    const configureOutputs = (outputs: string[]) => writeFileSync(join(stateDir, "config.json"), JSON.stringify({ workflow: { preparation: { command: ["node"], checkCommand: ["node"], inputs: ["package.json"], outputs } } }));
    configureOutputs(["node_modules"]);
    store.registerScope({ id: "self", rootPath: root, createdAt: now });
    const { epoch } = store.beginDaemonSession(now);
    store.admitRun({ id: "bootstrap", scopeId: "self", workflow: "fixture", repository: "write", trigger: { event: "manual", schemaRef: null, payload: {} }, resources: [], admittedAt: now });
    store.startRun("bootstrap", epoch, now);
    const sandbox = new RunSandboxManager(root).create({ runId: "bootstrap", repository: "write" });
    store.setSandbox("bootstrap", epoch, sandbox);
    writeFileSync(join(sandbox.workspaceDir, "runtime.mjs"), "console.log('new bootstrap ready');");
    execFileSync("git", ["add", "-A"], { cwd: sandbox.workspaceDir });
    execFileSync("git", ["commit", "-qm", "candidate"], { cwd: sandbox.workspaceDir });
    const candidate = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sandbox.workspaceDir, encoding: "utf8" }).trim();
    const transaction = { directory: "publication-dependencies-crash", outputs: ["node_modules"], previousOutputs: ["node_modules"] };
    const stage = join(sandbox.tempDir, transaction.directory);
    mkdirSync(join(stage, "previous"), { recursive: true });
    mkdirSync(join(stage, "next", "node_modules"), { recursive: true });
    const dependency = join(root, "node_modules", "boot-dependency");
    mkdirSync(dependency, { recursive: true });
    writeFileSync(join(dependency, "package.json"), JSON.stringify({ name: "boot-dependency", main: "index.cjs" }));
    writeFileSync(join(dependency, "index.cjs"), "module.exports = 'bootstrap ready';");
    store.beginIntegration("bootstrap", epoch, { contract: "run-lifecycle-v1", phase: "publishing", publishedHead: candidate, integratedFromHead: head, preparation: transaction });
    renameSync(join(root, "node_modules"), join(stage, "previous", "node_modules"));
    expect(() => execFileSync(process.execPath, ["runtime.mjs"], { cwd: root, stdio: "pipe" })).toThrow();
    const recovery = new URL("./repository-preparation-recovery.ts", import.meta.url).href;
    const startup = `import { recoverPreparationBeforeCliImports } from ${JSON.stringify(recovery)}; await recoverPreparationBeforeCliImports(${JSON.stringify(root)}); await import(${JSON.stringify(pathToFileURL(join(root, "runtime.mjs")).href)});`;
    // A command-selected scope can forge a journal pointing at real installation
    // scratch, but cannot acquire installation recovery authority.
    foreignStore.registerScope({ id: "self", rootPath: root, createdAt: now });
    const foreignEpoch = foreignStore.beginDaemonSession(now).epoch;
    foreignStore.admitRun({ id: "forged", scopeId: "self", workflow: "fixture", repository: "write", trigger: { event: "manual", schemaRef: null, payload: {} }, resources: [], admittedAt: now });
    foreignStore.startRun("forged", foreignEpoch, now);
    foreignStore.setSandbox("forged", foreignEpoch, sandbox);
    const forged = { ...transaction, outputs: ["src"], previousOutputs: ["src"] };
    mkdirSync(join(stage, "previous", "src"));
    writeFileSync(join(stage, "previous", "src", "index.ts"), "forged source");
    foreignStore.beginIntegration("forged", foreignEpoch, { contract: "run-lifecycle-v1", phase: "publishing", publishedHead: candidate, integratedFromHead: head, preparation: forged });
    const boot = () => execFileSync(process.execPath, ["--input-type=module", "-e", startup, "--", "fixture", "--scope-root", foreignRoot], { cwd: foreignRoot, env: { ...process.env, KOTA_SCOPE_ROOT: foreignRoot }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    for (const filename of ["daemon-instance.lock", "daemon-state.json"]) {
      writeFileSync(join(stateDir, filename), JSON.stringify({ pid: process.pid, token: "live-owner" }));
      expect(boot).toThrow(); // A live publisher's gap is never repaired by a client.
      expect(readFileSync(join(root, "src", "index.ts"), "utf8")).toBe("original source");
      rmSync(join(stateDir, filename));
    }
    // Even an installation-local journal cannot expand the permitted outputs.
    for (const output of ["src", "cache"]) {
      mkdirSync(join(root, output), { recursive: true });
      writeFileSync(join(root, output, "sentinel"), "untouched");
      const malicious = { ...transaction, outputs: [output], previousOutputs: [output] };
      store.updateIntegration("bootstrap", epoch, { contract: "run-lifecycle-v1", phase: "publishing", publishedHead: candidate, integratedFromHead: head, preparation: malicious });
      expect(boot).toThrow("Dependency recovery outputs differ from trusted preparation policy");
      expect(readFileSync(join(root, output, "sentinel"), "utf8")).toBe("untouched");
    }
    configureOutputs(["src"]);
    store.updateIntegration("bootstrap", epoch, { contract: "run-lifecycle-v1", phase: "publishing", publishedHead: candidate, integratedFromHead: head, preparation: forged });
    expect(boot).toThrow("Preparation output contains tracked content");
    expect(readFileSync(join(root, "src", "index.ts"), "utf8")).toBe("original source");
    configureOutputs(["node_modules"]);
    store.updateIntegration("bootstrap", epoch, { contract: "run-lifecycle-v1", phase: "publishing", publishedHead: candidate, integratedFromHead: head, preparation: transaction });
    expect(boot()).toBe("bootstrap ready\n");
    expect(readFileSync(join(root, "src", "index.ts"), "utf8")).toBe("original source");
    expect(boot()).toBe("bootstrap ready\n");
    // A crash after installing the new graph but before source publication
    // must also restore the old graph before the old bootstrap imports it.
    renameSync(join(root, "node_modules"), join(stage, "previous", "node_modules"));
    renameSync(join(stage, "next", "node_modules"), join(root, "node_modules"));
    expect(boot()).toBe("bootstrap ready\n");
    // Once source moved, startup keeps the new graph instead of rolling back.
    renameSync(join(root, "node_modules"), join(stage, "previous", "node_modules"));
    renameSync(join(stage, "next", "node_modules"), join(root, "node_modules"));
    git("merge", "--ff-only", candidate);
    expect(boot()).toBe("new bootstrap ready\n");
    expect(boot()).toBe("new bootstrap ready\n");
    expect(store.getRun("bootstrap")?.integration?.preparation).toEqual(transaction);
  } finally { store.close(); foreignStore.close(); rmSync(root, { recursive: true, force: true }); rmSync(foreignRoot, { recursive: true, force: true }); }
});
