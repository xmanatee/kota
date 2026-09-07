import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { withNativeCliSandbox } from "#core/agent-harness/native-cli-sandbox.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import {
  createRepoTaskRuntimeSandbox,
  disposeRepoTaskRuntimeSandboxes,
  finishRepoTaskRuntimeSandbox,
} from "#modules/repo-tasks/repo-task-mutation-test-support.js";

const roots: string[] = [];

afterEach(() => {
  disposeRepoTaskRuntimeSandboxes();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("native writer authorization boundary", () => {
  it("revalidates task mutations through a host service without exposing state to the caller", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-native-authorization-worker-"));
    roots.push(root);
    const target = createRepoTaskRuntimeSandbox(root, "worker-run");
    const env = {
      KOTA_RUN_ID: "worker-run", KOTA_RUN_ATTEMPT: "1", KOTA_DAEMON_EPOCH: "1",
      KOTA_RUN_STATE_DIR: join(root, ".kota"),
    };
    let childEnv: NodeJS.ProcessEnv = {};
    let serviceRoot = "";
    const sourceRoot = resolve("src");
    const invoke = (overrides: NodeJS.ProcessEnv = {}, workspace = target.workspaceRoot) => new Promise<unknown>((resolve, reject) => {
      const worker = new Worker(`
        const { parentPort, workerData } = require("node:worker_threads");
        (async () => {
          const { tsImport } = await import("tsx/esm/api");
          const { completeTask } = await tsImport(workerData.module, workerData.parent);
          parentPort.postMessage(await completeTask(workerData.workspace, workerData.env));
        })().catch(error => { throw error; });
      `, {
        eval: true,
        workerData: {
          module: join(sourceRoot, "native-run-repository-access.integration.ts"),
          parent: import.meta.url, workspace,
          env: { ...childEnv, ...overrides },
        },
      });
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) => { if (code !== 0) reject(new Error(`Worker exited: ${code}`)); });
    });
    await withNativeCliSandbox(process.execPath, [], {
      cwd: target.workspaceRoot, machineAuthorityOwner: "native-cli",
      writableRoots: [target.workspaceRoot], env,
      prepareEnvironment(context, projectedEnv) {
        expect(projectedEnv.KOTA_RUN_STATE_DIR).toBeUndefined();
        const database = join(root, ".kota", "kota.sqlite");
        expect(context.readableRoots).not.toContain(database);
        expect(context.readProtectedPaths).toContain(database);
        const responses = context.writeProtectedPaths.find((path) => path.endsWith("/responses"))!;
        serviceRoot = resolve(responses, "..");
        expect(context.writableRoots).toContain(join(serviceRoot, "requests"));
        expect(context.writableRoots).not.toContain(responses);
        return projectedEnv;
      },
    }, async (child) => {
      childEnv = child.env;
      expect(await invoke()).toMatchObject({ ok: true, toState: "done" });
      expect(readFileSync(join(target.workspaceRoot, "data/tasks/archive/task-authorized-worker.md"), "utf8"))
        .toContain("status: done");
      await expect(invoke({ KOTA_RUN_ATTEMPT: "2" })).rejects.toThrow(/authorization denied/i);
      await expect(invoke({ KOTA_DAEMON_EPOCH: "2" })).rejects.toThrow(/authorization denied/i);
      await expect(invoke({ KOTA_RUN_ID: "other-run" })).rejects.toThrow();
      await expect(invoke({}, root)).rejects.toThrow(/reconciled writer workspace/);
      await expect(invoke({ KOTA_RUN_AUTHORIZATION: "" })).rejects.toThrow(/authorization denied/i);
      finishRepoTaskRuntimeSandbox(target.workspaceRoot);
      await expect(invoke()).rejects.toThrow(/authorization denied/i);
    });
    expect(existsSync(serviceRoot)).toBe(false);
    await expect(invoke()).rejects.toThrow();
  });

  it("enforces database and response protection in the OS sandbox while permitting task completion", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-native-child-run-state-"));
    roots.push(root);
    const runId = "run-native-child";
    const target = createRepoTaskRuntimeSandbox(root, runId);
    const stateDir = join(root, ".kota");
    const database = join(stateDir, "kota.sqlite");
    const store = new RunStateDatabase(stateDir);
    try {
      store.registerScope({ id: "unrelated", rootPath: join(root, "other"), createdAt: "2026-09-07T00:00:00Z" });
      store.admitRun({
        id: "unrelated-run", scopeId: "unrelated", workflow: "private", repository: "none",
        trigger: { event: "private", schemaRef: null, payload: { secret: "other-scope-private-trigger" } },
        resources: [], admittedAt: "2026-09-07T00:00:00Z",
      });
    } finally { store.close(); }
    // Keep the owner fixture's connection open so live WAL and SHM reads are exercised.
    const databasePaths = [database, `${database}-wal`, `${database}-shm`];
    for (const path of databasePaths) expect(existsSync(path)).toBe(true);
    const sourceRoot = resolve("src");
    const loader = createRequire(import.meta.url).resolve("tsx");
    const script = join(target.workspaceRoot, "complete-task.mjs");
    writeFileSync(script, [
      'import { readFileSync, writeFileSync } from "node:fs";',
      `import { nativeRunRepositoryAccess } from ${JSON.stringify(join(sourceRoot, "core/workflow/run-context.ts"))};`,
      `import { mutateRepoTask } from ${JSON.stringify(join(sourceRoot, "modules/repo-tasks/repo-task-mutation-boundary.ts"))};`,
      `for (const path of ${JSON.stringify(databasePaths)}) {`,
      '  try { if (readFileSync(path).length > 0) throw new Error("Database exposed: " + path); }',
      '  catch (error) { if (!["EACCES", "EPERM", "ENOENT"].includes(error.code)) throw error; }',
      '}',
      'if (process.env.KOTA_RUN_STATE_DIR) throw new Error("Raw state locator exposed");',
      'try { writeFileSync(process.env.RESPONSE_PROBE, "true"); throw new Error("Authorization response writable"); }',
      'catch (error) { if (!["EACCES", "EPERM", "EROFS"].includes(error.code)) throw error; }',
      'const target = { authority: "runtime-owned-sandbox", repositoryAccess: nativeRunRepositoryAccess(process.cwd()) };',
      'await mutateRepoTask(target, { kind: "create", options: { title: "Native completion", priority: "p2" } });',
      'const result = await mutateRepoTask(target, { kind: "move", id: "task-native-completion", state: "done" });',
      'process.stdout.write(JSON.stringify(result));',
    ].join("\n"));
    const env = {
      PATH: process.env.PATH ?? "",
      KOTA_RUN_ID: runId,
      KOTA_RUN_ATTEMPT: "1",
      KOTA_DAEMON_EPOCH: "1",
      KOTA_RUN_STATE_DIR: stateDir,
    };
    let responseRoot = "";
    let serviceRoot = "";
    await withNativeCliSandbox(
      process.execPath,
      ["--conditions=source", "--import", loader, script],
      {
        cwd: target.workspaceRoot,
        machineAuthorityOwner: "kota",
        writableRoots: [target.workspaceRoot],
        runtimeStateRoot: stateDir,
        runtimeWritableRoots: [],
        // Runtime state is mounted by its write boundary without a host read grant.
        readOnlyHostRoots: [sourceRoot, resolve("node_modules"), resolve("package.json"), resolve("tsconfig.json")],
        env,
        prepareEnvironment(context, childEnv) {
          for (const path of databasePaths) expect(context.readProtectedPaths).toContain(path);
          responseRoot = context.writeProtectedPaths.find((path) => path.endsWith("/responses"))!;
          serviceRoot = resolve(responseRoot, "..");
          expect(context.writableRoots).not.toContain(responseRoot);
          expect(context.writableRoots).toContain(join(serviceRoot, "requests"));
          return { ...childEnv, RESPONSE_PROBE: join(responseRoot, "forged") };
        },
      },
      async (child) => {
        const invoke = (overrides: NodeJS.ProcessEnv = {}) => new Promise<string>((resolve, reject) => {
          const process = spawn(child.command, child.args, {
            cwd: target.workspaceRoot, env: { ...child.env, ...overrides }, stdio: ["ignore", "pipe", "pipe"],
          });
          let stdout = "";
          let stderr = "";
          process.stdout.on("data", (chunk) => { stdout += chunk; });
          process.stderr.on("data", (chunk) => { stderr += chunk; });
          process.once("error", reject);
          process.once("close", (status) => status === 0 ? resolve(stdout) : reject(new Error(stderr)));
        });
        expect(JSON.parse(await invoke())).toMatchObject({ ok: true, toState: "done" });
        expect(readFileSync(join(target.workspaceRoot, "data/tasks/archive/task-native-completion.md"), "utf8"))
          .toContain("status: done");
        expect(existsSync(join(root, "data/tasks/archive/task-native-completion.md"))).toBe(false);

      },
    );
    expect(existsSync(serviceRoot)).toBe(false);
  });
});
