import {
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import { createSubprocessExecutor } from "./subprocess-executor.js";
import {
  cleanupSubprocessTestDirs,
  createSubprocessTestDirs,
  type SubprocessTestDirs,
  writeFakeContainerBackend,
  writeFakeKotaScript,
} from "./subprocess-executor-test-helpers.js";

describe("createSubprocessExecutor container execution", () => {
  let dirs: SubprocessTestDirs;

  beforeEach(() => {
    dirs = createSubprocessTestDirs();
  });

  afterEach(() => {
    delete process.env.KOTA_FAKE_CONTAINER_LOG;
    delete process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_SOURCE;
    delete process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_PATH;
    cleanupSubprocessTestDirs(dirs);
  });

  it("refuses to run a container when provider-egress enforcement is unavailable", async () => {
    const fakeContainer = join(dirs.binariesDir, "fake-container.mjs");
    const fakeKota = join(dirs.binariesDir, "unused-kota.mjs");
    const fakeContainerLog = join(dirs.workingDir, "container-should-not-run.jsonl");
    writeFakeContainerBackend(fakeContainer);
    writeFakeKotaScript(fakeKota, "process.exit(0);\n");
    const executor = createSubprocessExecutor({
      kotaBinaryPath: fakeKota,
      isolationBackend: {
        kind: "container",
        executable: fakeContainer,
        image: "kota-eval:latest",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
        networkPolicy: {
          kind: "provider-egress",
          provider: "openai",
          enforcement: {
            kind: "docker-internal-proxy",
            networkName: "missing-network",
            proxyUrl: "http://provider-proxy:8080",
          },
        },
      },
    });
    const preflight = executor.preflight(containerProfile());
    if (preflight.status !== "non-gating") throw new Error("unreachable");

    process.env.KOTA_FAKE_CONTAINER_LOG = fakeContainerLog;
    const outcome = await executor.execute({
      workflowName: "noop",
      workingDir: dirs.workingDir,
      budgetMs: 5_000,
      executionProfile: preflight,
    });

    expect(outcome.kind).toBe("error");
    if (outcome.kind !== "error") throw new Error("unreachable");
    expect(outcome.message).toMatch(/refusing to downgrade/);
    expect(existsSync(fakeContainerLog)).toBe(false);
  });

  it("runs the fixture command through the container backend with isolated environment and copy-back", async () => {
    const fakeContainer = join(dirs.binariesDir, "fake-container.mjs");
    const fakeKota = join(dirs.binariesDir, "kota-container-env.mjs");
    const containerKotaBinaryPath = "/opt/kota/bin/kota.mjs";
    const fakeContainerLog = join(dirs.workingDir, "container-log.jsonl");
    writeFakeContainerBackend(fakeContainer);
    writeFakeKotaScript(
      fakeKota,
      [
        "import { spawnSync } from 'node:child_process';",
        "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "writeFileSync(join(process.cwd(), 'env.json'), JSON.stringify({",
        "  home: process.env.HOME,",
        "  workspaceRoot: process.env.KOTA_SCOPE_ROOT,",
        "  distDir: process.env.KOTA_DIST_DIR,",
        "  cacheDir: process.env.XDG_CACHE_HOME,",
        "  storeDir: process.env.npm_config_store_dir,",
        "  nodeOptions: process.env.NODE_OPTIONS,",
        "  path: process.env.PATH,",
        `  preset: process.env.${PRESET_ENV_VAR},`,
        "}));",
        "const runDir = join(process.cwd(), '.kota', 'runs', 'run-1-noop-container');",
        "mkdirSync(runDir, { recursive: true });",
        "writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({",
        "  metadataVersion: 1, id: 'run-1-noop-container', workflow: 'noop', status: 'success',",
        "  definitionPath: 'workflows/noop.ts', trigger: { event: 'eval.fixture', schemaRef: null, payload: {} }, startedAt: '2026-04-24T00:00:00.000Z', completedAt: '2026-04-24T00:00:01.000Z', runDir, steps: [],",
        "}));",
      ].join("\n"),
    );

    const executor = createSubprocessExecutor({
      kotaBinaryPath: fakeKota,
      isolationBackend: containerBackend(fakeContainer, containerKotaBinaryPath),
    });
    expect(executor.predicateContext?.executableVerifierSandbox).toMatchObject({
      kind: "oci-container",
      command: fakeContainer,
      image: "kota-eval:latest",
    });
    const preflight = executor.preflight(containerProfile());
    if (preflight.status !== "verified") throw new Error("unreachable");

    process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_PATH = containerKotaBinaryPath;
    process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_SOURCE = fakeKota;
    process.env.KOTA_FAKE_CONTAINER_LOG = fakeContainerLog;
    {
      const outcome = await executor.execute({
        workflowName: "noop",
        workingDir: dirs.workingDir,
        budgetMs: 5_000,
        executionProfile: preflight,
      });

      expect(outcome.kind).toBe("completed");
      expect(outcome.runArtifactPath).toContain("run-1-noop-container");
    }

    const envCapture = JSON.parse(
      readFileSync(join(dirs.workingDir, "env.json"), "utf8"),
    ) as Record<string, string>;
    expect(envCapture.home).toBe(
      join(dirs.workingDir, "node_modules", ".kota-eval-runtime", "home"),
    );
      expect(envCapture.workspaceRoot).toBe(dirs.workingDir);
      expect(envCapture.distDir).toBe("/opt/kota/dist");
      expect(envCapture.cacheDir).toBe(
        join(dirs.workingDir, "node_modules", ".kota-eval-runtime", "cache"),
      );
      expect(envCapture.storeDir).toBe(
        join(dirs.workingDir, "node_modules", ".kota-eval-runtime", "pnpm-store"),
      );
    expect(envCapture.nodeOptions).toBeUndefined();

    const log = JSON.parse(
      readFileSync(fakeContainerLog, "utf8").trim().split("\n")[0]!,
    ) as {
      args: string[];
      image: string;
      command: string;
      commandArgs: string[];
      mounts: string[];
      env: Record<string, string>;
      envFiles: string[];
      envFileModes: string[];
      workdir: string;
    };
    expect(log.image).toBe("kota-eval:latest");
    expect(log.command).toBe("node");
    expect(log.commandArgs.slice(0, 4)).toEqual([
      containerKotaBinaryPath,
      "workflow",
      "exec",
      "noop",
    ]);
    expect(log.workdir).toBe(dirs.workingDir);
    expect(log.args).toEqual(
      expect.arrayContaining([
        "--network",
        "none",
        "--cpus",
        "2",
        "--memory-reservation",
        "1024m",
        "--memory",
        "2048m",
      ]),
    );
    expect(log.args.filter((arg) => arg === "--mount")).toHaveLength(1);
    expect(log.mounts).toEqual([
      `type=bind,source=${dirs.workingDir},target=${dirs.workingDir}`,
    ]);
    const networkIndex = log.args.indexOf("--network");
    expect(log.args[networkIndex + 1]).toBe("none");
    expect(log.args).toContain("--env-file");
    expect(log.args).not.toContain("--env");
    expect(log.envFiles).toHaveLength(1);
    expect(log.envFileModes).toEqual(["600"]);
    expect(existsSync(log.envFiles[0]!)).toBe(false);
    expect(log.args).not.toContain("--privileged");
    expect(log.args).not.toContain("--device");
    expect(log.env.KOTA_PARENT_SECRET_LEAK_TEST).toBeUndefined();
  });

  it("reports timeout when the container backend exceeds the fixture budget", async () => {
    const fakeContainer = join(dirs.binariesDir, "fake-container.mjs");
    const fakeKota = join(dirs.binariesDir, "unused-kota.mjs");
    writeFakeContainerBackend(fakeContainer);
    writeFakeKotaScript(fakeKota, "process.exit(0);\n");
    const executor = createSubprocessExecutor({
      kotaBinaryPath: fakeKota,
      isolationBackend: {
        ...containerBackend(fakeContainer, "/opt/kota/bin/kota.mjs"),
        image: "sleep:image",
      },
    });
    const preflight = executor.preflight({
      hostClass: "container-test",
      cpuAllocationCores: 1,
      cpuKillThresholdCores: 1,
      memoryAllocationMB: 512,
      memoryKillThresholdMB: 512,
    });
    if (preflight.status !== "verified") throw new Error("unreachable");

    const outcome = await executor.execute({
      workflowName: "sleepy",
      workingDir: dirs.workingDir,
      budgetMs: 200,
      executionProfile: preflight,
    });

    expect(outcome.kind).toBe("timeout");
    expect(outcome.runArtifactPath).toBeNull();
  });
});

function containerProfile() {
  return {
    hostClass: "container-test",
    cpuAllocationCores: 2,
    cpuKillThresholdCores: 2,
    memoryAllocationMB: 1024,
    memoryKillThresholdMB: 2048,
  };
}

function containerBackend(executable: string, kotaBinaryPath: string) {
  return {
    kind: "container" as const,
    executable,
    image: "kota-eval:latest",
    kotaBinaryPath,
  };
}
