import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withNativeCliSandbox } from "#core/agent-harness/native-cli-sandbox.js";
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

describe("native writer run-state sandbox", () => {
  it("allows sandbox task completion only while its runtime attempt is active", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-native-child-run-state-"));
    roots.push(root);
    const runId = "run-native-child";
    const target = createRepoTaskRuntimeSandbox(root, runId);
    const sourceRoot = resolve("src");
    const loader = createRequire(import.meta.url).resolve("tsx");
    const script = join(target.workspaceRoot, "complete-task.mjs");
    writeFileSync(script, [
      `import { nativeRunRepositoryAccess } from ${JSON.stringify(join(sourceRoot, "modules/repo-tasks/native-run-repository-access.ts"))};`,
      `import { mutateRepoTask } from ${JSON.stringify(join(sourceRoot, "modules/repo-tasks/repo-task-mutation-boundary.ts"))};`,
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
      KOTA_RUN_STATE_DIR: join(root, ".kota"),
    };

    const invoke = () => withNativeCliSandbox(
      process.execPath,
      ["--conditions=source", "--import", loader, script],
      {
        cwd: target.workspaceRoot,
        machineAuthorityOwner: "kota",
        writableRoots: [target.workspaceRoot],
        runtimeStateRoot: join(root, ".kota"),
        runtimeWritableRoots: [],
        readOnlyHostRoots: [sourceRoot, resolve("node_modules"), resolve("package.json"), resolve("tsconfig.json")],
        env,
      },
      async (child) => {
        const result = spawnSync(child.command, child.args, {
          cwd: target.workspaceRoot,
          env: child.env,
          encoding: "utf8",
        });
        if (result.status !== 0) throw new Error(result.stderr);
        return result.stdout;
      },
    );

    expect(JSON.parse(await invoke())).toMatchObject({ ok: true, toState: "done" });
    expect(readFileSync(join(target.workspaceRoot, "data/tasks/archive/task-native-completion.md"), "utf8"))
      .toContain("status: done");
    expect(existsSync(join(root, "data/tasks/archive/task-native-completion.md"))).toBe(false);
    finishRepoTaskRuntimeSandbox(target.workspaceRoot);
    await expect(invoke()).rejects.toThrow(/not active/);
  });
});
