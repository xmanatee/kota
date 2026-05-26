/**
 * Focused tests for createSubprocessExecutor.
 *
 * The production executor invokes `kota workflow exec <name>` inside a
 * fixture's isolated working directory. These tests substitute a tiny
 * stand-in script for the kota binary so the subprocess contract — budget
 * timeout, clean-exit-but-no-run, non-zero exit — is exercised without
 * running the real module loader.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import { REPLAY_AGENT_HARNESS_NAME_ENV } from "./replay-harness.js";
import {
  createSubprocessExecutor,
  detectHostSubprocessResourceProfile,
} from "./subprocess-executor.js";

function writeFakeKotaScript(path: string, body: string): void {
  writeFileSync(path, body, "utf-8");
  chmodSync(path, 0o755);
}

function writeTerminalRun(
  workingDir: string,
  workflowName: string,
  runId: string,
  status: "success" | "failed",
): void {
  const runDir = join(workingDir, ".kota", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "metadata.json"),
    JSON.stringify({ id: runId, workflow: workflowName, status }),
  );
}

function writeFakeContainerBackend(path: string): void {
  writeFakeKotaScript(
    path,
    [
      "#!/usr/bin/env node",
      "import { spawnSync } from 'node:child_process';",
      "import { appendFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "if (args[0] === '--version') process.exit(0);",
      "if (args[0] === 'image' && args[1] === 'inspect') {",
      "  process.exit(args[2] === 'missing:image' ? 2 : 0);",
      "}",
      "if (args[0] !== 'run') process.exit(64);",
      "const env = {};",
      "const mounts = [];",
      "let workdir = process.cwd();",
      "let image = null;",
      "let index = 1;",
      "while (index < args.length) {",
      "  const arg = args[index];",
      "  if (arg === '--rm' || arg === '--init') { index += 1; continue; }",
      "  if (arg === '--mount') { mounts.push(args[index + 1]); index += 2; continue; }",
      "  if (arg === '--network' || arg === '--cpus' || arg === '--memory-reservation' || arg === '--memory') { index += 2; continue; }",
      "  if (arg === '--workdir') { workdir = args[index + 1]; index += 2; continue; }",
      "  if (arg === '--env') {",
      "    const raw = args[index + 1];",
      "    const eq = raw.indexOf('=');",
      "    env[raw.slice(0, eq)] = raw.slice(eq + 1);",
      "    index += 2;",
      "    continue;",
      "  }",
      "  image = arg;",
      "  index += 1;",
      "  break;",
      "}",
      "if (process.env.KOTA_FAKE_CONTAINER_LOG) {",
      "  appendFileSync(process.env.KOTA_FAKE_CONTAINER_LOG, JSON.stringify({ args, env, mounts, workdir, image, command: args[index], commandArgs: args.slice(index + 1) }) + '\\n');",
      "}",
      "const mountTargets = mounts.map((mount) => {",
      "  const fields = {};",
      "  for (const part of mount.split(',')) {",
      "    const eq = part.indexOf('=');",
      "    if (eq === -1) fields[part] = 'true';",
      "    else fields[part.slice(0, eq)] = part.slice(eq + 1);",
      "  }",
      "  return fields.target;",
      "}).filter((target) => typeof target === 'string');",
      "if (image === 'sleep:image') {",
      "  setInterval(() => {}, 1000);",
      "} else {",
      "const commandArgs = args.slice(index + 1);",
      "if (args[index] === 'node' && process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_PATH === commandArgs[0] && process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_SOURCE) {",
      "  commandArgs[0] = process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_SOURCE;",
      "}",
      "const result = spawnSync(args[index], commandArgs, {",
      "  cwd: workdir,",
      "  env: { ...process.env, ...env, KOTA_FAKE_CONTAINER_VISIBLE_MOUNTS: JSON.stringify(mountTargets) },",
      "  stdio: ['ignore', 'inherit', 'inherit'],",
      "});",
      "process.exit(result.status ?? 1);",
      "}",
    ].join("\n"),
  );
}

describe("createSubprocessExecutor", () => {
  let binariesDir: string;
  let workingDir: string;

  beforeEach(() => {
    binariesDir = mkdtempSync(join(tmpdir(), "kota-subprocess-bin-"));
    workingDir = mkdtempSync(join(tmpdir(), "kota-subprocess-work-"));
  });

  afterEach(() => {
    rmSync(binariesDir, { recursive: true, force: true });
    rmSync(workingDir, { recursive: true, force: true });
  });

  it("reports timeout when the child exceeds the fixture budget", async () => {
    const fakeKota = join(binariesDir, "kota-sleep.mjs");
    writeFakeKotaScript(
      fakeKota,
      "setInterval(() => {}, 1000);\n",
    );

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "sleepy",
      workingDir,
      budgetMs: 200,
    });

    expect(outcome.kind).toBe("timeout");
    expect(outcome.runArtifactPath).toBeNull();
    expect(outcome.durationMs).toBeGreaterThanOrEqual(200);
  });

  it("reports error when the child exits cleanly without a run artifact", async () => {
    const fakeKota = join(binariesDir, "kota-silent.mjs");
    writeFakeKotaScript(fakeKota, "process.exit(0);\n");

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "ghost",
      workingDir,
      budgetMs: 5_000,
    });

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toMatch(/no terminal run artifact/);
    }
  });

  it("reports completed when the child exits 0 and a terminal run exists", async () => {
    writeTerminalRun(workingDir, "noop", "run-1-noop-abc", "success");
    const fakeKota = join(binariesDir, "kota-success.mjs");
    writeFakeKotaScript(fakeKota, "process.exit(0);\n");

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "noop",
      workingDir,
      budgetMs: 5_000,
    });

    expect(outcome.kind).toBe("completed");
    expect(outcome.runArtifactPath).toContain("run-1-noop-abc");
  });

  it("pins replay runs to the claude preset so recordings override the active harness", async () => {
    const fakeKota = join(binariesDir, "kota-env-capture.mjs");
    writeFakeKotaScript(
      fakeKota,
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "writeFileSync(join(process.cwd(), 'env.json'), JSON.stringify({",
        `  preset: process.env.${PRESET_ENV_VAR},`,
        `  replayRoot: process.env.${REPLAY_AGENT_HARNESS_NAME_ENV},`,
        "}));",
        "const runDir = join(process.cwd(), '.kota', 'runs', 'run-1-noop-replay');",
        "mkdirSync(runDir, { recursive: true });",
        "writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({",
        "  id: 'run-1-noop-replay', workflow: 'noop', status: 'success',",
        "}));",
      ].join("\n"),
    );

    const executor = createSubprocessExecutor({
      kotaBinaryPath: fakeKota,
      extraEnv: { [PRESET_ENV_VAR]: "codex" },
    });
    const outcome = await executor.execute({
      workflowName: "noop",
      workingDir,
      budgetMs: 5_000,
      replayRecordingsRoot: "/fixtures/replay",
    });

    expect(outcome.kind).toBe("completed");
    const envCapture = JSON.parse(
      readFileSync(join(workingDir, "env.json"), "utf8"),
    ) as Record<string, string>;
    expect(envCapture.preset).toBe("claude");
    expect(envCapture.replayRoot).toBe("/fixtures/replay");
  });

  it("marks host subprocess preflight as explicit non-gating evidence", () => {
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(binariesDir, "unused.mjs"),
    });
    const requestedProfile = detectHostSubprocessResourceProfile("host-test");
    const preflight = executor.preflight(requestedProfile);

    expect(preflight.status).toBe("non-gating");
    expect(preflight.backendKind).toBe("host-subprocess");
    expect(preflight.gateEligible).toBe(false);
    if (preflight.status !== "non-gating") throw new Error("unreachable");
    expect(preflight.nonGatingReason).toBe("host-subprocess-unverified");
    expect(preflight.observedOrEnforcedProfile).toEqual(requestedProfile);
  });

  it("rejects requested resource profiles that do not match observed host facts", () => {
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(binariesDir, "unused.mjs"),
    });
    const observedProfile = detectHostSubprocessResourceProfile("host-test");
    const preflight = executor.preflight({
      ...observedProfile,
      cpuKillThresholdCores: observedProfile.cpuKillThresholdCores + 1,
    });

    expect(preflight.status).toBe("rejected");
    if (preflight.status !== "rejected") throw new Error("unreachable");
    expect(preflight.rejectionReason).toBe("requested-observed-mismatch");
  });

  it("reports a missing optional container backend as typed non-gating preflight", () => {
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(binariesDir, "unused.mjs"),
      isolationBackend: {
        kind: "container",
        executable: "kota-eval-missing-container-backend",
        image: "kota-eval:latest",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      },
    });
    const requestedProfile = detectHostSubprocessResourceProfile("host-test");
    const preflight = executor.preflight(requestedProfile);

    expect(preflight.status).toBe("non-gating");
    expect(preflight.backendKind).toBe("missing-isolation-backend");
    if (preflight.status !== "non-gating") throw new Error("unreachable");
    expect(preflight.nonGatingReason).toBe("isolation-backend-unavailable");
  });

  it("reports container image/config problems as typed non-gating preflight", () => {
    const fakeContainer = join(binariesDir, "fake-container.mjs");
    writeFakeContainerBackend(fakeContainer);
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(binariesDir, "unused.mjs"),
      isolationBackend: {
        kind: "container",
        executable: fakeContainer,
        image: "missing:image",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      },
    });
    const requestedProfile = {
      hostClass: "container-test",
      cpuAllocationCores: 2,
      cpuKillThresholdCores: 2,
      memoryAllocationMB: 1024,
      memoryKillThresholdMB: 2048,
    };
    const preflight = executor.preflight(requestedProfile);

    expect(preflight.status).toBe("non-gating");
    expect(preflight.backendKind).toBe("container");
    if (preflight.status !== "non-gating") throw new Error("unreachable");
    expect(preflight.nonGatingReason).toBe(
      "isolation-backend-config-invalid",
    );
    expect(preflight.gateEligible).toBe(false);
  });

  it("rejects container resource profiles the backend cannot represent", () => {
    const fakeContainer = join(binariesDir, "fake-container.mjs");
    writeFakeContainerBackend(fakeContainer);
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(binariesDir, "unused.mjs"),
      isolationBackend: {
        kind: "container",
        executable: fakeContainer,
        image: "kota-eval:latest",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      },
    });
    const preflight = executor.preflight({
      hostClass: "container-test",
      cpuAllocationCores: 1,
      cpuKillThresholdCores: 2,
      memoryAllocationMB: 1024,
      memoryKillThresholdMB: 1024,
    });

    expect(preflight.status).toBe("rejected");
    if (preflight.status !== "rejected") throw new Error("unreachable");
    expect(preflight.backendKind).toBe("container");
    expect(preflight.rejectionReason).toBe("requested-observed-mismatch");
    expect(preflight.observedOrEnforcedProfile.cpuAllocationCores).toBe(2);
  });

  it("verifies an available container backend as gate-eligible enforced profile", () => {
    const fakeContainer = join(binariesDir, "fake-container.mjs");
    writeFakeContainerBackend(fakeContainer);
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(binariesDir, "unused.mjs"),
      isolationBackend: {
        kind: "container",
        executable: fakeContainer,
        image: "kota-eval:latest",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      },
    });
    const requestedProfile = {
      hostClass: "container-test",
      cpuAllocationCores: 2,
      cpuKillThresholdCores: 2,
      memoryAllocationMB: 1024,
      memoryKillThresholdMB: 2048,
    };
    const preflight = executor.preflight(requestedProfile);

    expect(preflight.status).toBe("verified");
    expect(preflight.backendKind).toBe("container");
    expect(preflight.verification).toBe("enforced");
    expect(preflight.gateEligible).toBe(true);
    expect(preflight.observedOrEnforcedProfile).toEqual(requestedProfile);
  });

  it("remaps HOME and KOTA_PROJECT_DIR inside the child process", async () => {
    const fakeKota = join(binariesDir, "kota-home-capture.mjs");
    writeFakeKotaScript(
      fakeKota,
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "writeFileSync(join(process.cwd(), 'env.json'), JSON.stringify({",
        "  home: process.env.HOME,",
        "  projectDir: process.env.KOTA_PROJECT_DIR,",
        "}));",
        "const runDir = join(process.cwd(), '.kota', 'runs', 'run-1-noop-env');",
        "mkdirSync(runDir, { recursive: true });",
        "writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({",
        "  id: 'run-1-noop-env', workflow: 'noop', status: 'success',",
        "}));",
      ].join("\n"),
    );

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "noop",
      workingDir,
      budgetMs: 5_000,
    });

    expect(outcome.kind).toBe("completed");
    const envCapture = JSON.parse(
      readFileSync(join(workingDir, "env.json"), "utf8"),
    ) as Record<string, string>;
    expect(envCapture.home).toBe(workingDir);
    expect(envCapture.projectDir).toBe(workingDir);
  });

  it("runs the fixture command through the container backend with remapped env, replay, shims, and copy-back", async () => {
    const fakeContainer = join(binariesDir, "fake-container.mjs");
    const fakeKota = join(binariesDir, "kota-container-env.mjs");
    const containerKotaBinaryPath = "/opt/kota/bin/kota.mjs";
    const fakeContainerLog = join(workingDir, "container-log.jsonl");
    const replayRoot = mkdtempSync(join(tmpdir(), "kota-subprocess-replay-"));
    const shimDir = join(workingDir, ".kota", "shims");
    mkdirSync(shimDir, { recursive: true });
    mkdirSync(join(replayRoot, "recordings"), { recursive: true });
    writeFileSync(join(replayRoot, "recordings", "noop.json"), "recorded");
    writeFakeContainerBackend(fakeContainer);
    writeFakeKotaScript(
      join(shimDir, "fake-gh"),
      [
        "#!/usr/bin/env node",
        "import { writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "writeFileSync(join(process.env.KOTA_PROJECT_DIR, 'shim-hit.txt'), JSON.stringify({ argv: process.argv.slice(2) }));",
      ].join("\n"),
    );
    writeFakeKotaScript(
      fakeKota,
      [
        "import { spawnSync } from 'node:child_process';",
        "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        `const replayRoot = process.env.${REPLAY_AGENT_HARNESS_NAME_ENV};`,
        "const visibleMounts = JSON.parse(process.env.KOTA_FAKE_CONTAINER_VISIBLE_MOUNTS ?? '[]');",
        "if (!visibleMounts.some((mount) => replayRoot === mount || replayRoot.startsWith(`${mount}/`))) {",
        "  console.error(`replay root ${replayRoot} is not visible through a container mount`);",
        "  process.exit(70);",
        "}",
        "const replayContent = readFileSync(join(replayRoot, 'recordings', 'noop.json'), 'utf8');",
        "spawnSync('fake-gh', ['status'], { stdio: 'ignore' });",
        "writeFileSync(join(process.cwd(), 'env.json'), JSON.stringify({",
        "  home: process.env.HOME,",
        "  projectDir: process.env.KOTA_PROJECT_DIR,",
        "  distDir: process.env.KOTA_DIST_DIR,",
        "  path: process.env.PATH,",
        `  preset: process.env.${PRESET_ENV_VAR},`,
        `  replayRoot: process.env.${REPLAY_AGENT_HARNESS_NAME_ENV},`,
        "  replayContent,",
        "}));",
        "const runDir = join(process.cwd(), '.kota', 'runs', 'run-1-noop-container');",
        "mkdirSync(runDir, { recursive: true });",
        "writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({",
        "  id: 'run-1-noop-container', workflow: 'noop', status: 'success',",
        "}));",
      ].join("\n"),
    );

    const executor = createSubprocessExecutor({
      kotaBinaryPath: fakeKota,
      isolationBackend: {
        kind: "container",
        executable: fakeContainer,
        image: "kota-eval:latest",
        kotaBinaryPath: containerKotaBinaryPath,
      },
    });
    const preflight = executor.preflight({
      hostClass: "container-test",
      cpuAllocationCores: 2,
      cpuKillThresholdCores: 2,
      memoryAllocationMB: 1024,
      memoryKillThresholdMB: 2048,
    });
    if (preflight.status !== "verified") throw new Error("unreachable");

    process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_PATH = containerKotaBinaryPath;
    process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_SOURCE = fakeKota;
    process.env.KOTA_FAKE_CONTAINER_LOG = fakeContainerLog;
    try {
      try {
        const outcome = await executor.execute({
          workflowName: "noop",
          workingDir,
          budgetMs: 5_000,
          executionProfile: preflight,
          replayRecordingsRoot: replayRoot,
          externalCallShimDir: shimDir,
        });

        expect(outcome.kind).toBe("completed");
        expect(outcome.runArtifactPath).toContain("run-1-noop-container");
      } finally {
        rmSync(replayRoot, { recursive: true, force: true });
      }
    } finally {
      delete process.env.KOTA_FAKE_CONTAINER_LOG;
      delete process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_SOURCE;
      delete process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_PATH;
    }

    const envCapture = JSON.parse(
      readFileSync(join(workingDir, "env.json"), "utf8"),
    ) as Record<string, string>;
    expect(envCapture.home).toBe(workingDir);
    expect(envCapture.projectDir).toBe(workingDir);
    expect(envCapture.distDir).toBe("/opt/kota/dist");
    expect(envCapture.preset).toBe("claude");
    expect(envCapture.replayRoot).toBe(replayRoot);
    expect(envCapture.replayContent).toBe("recorded");
    expect(envCapture.path.startsWith(`${shimDir}:`)).toBe(true);
    expect(existsSync(join(workingDir, "shim-hit.txt"))).toBe(true);

    const log = JSON.parse(
      readFileSync(fakeContainerLog, "utf8").trim().split("\n")[0]!,
    ) as {
      args: string[];
      image: string;
      command: string;
      commandArgs: string[];
      mounts: string[];
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
    expect(log.workdir).toBe(workingDir);
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
    expect(log.args.filter((arg) => arg === "--mount")).toHaveLength(2);
    expect(log.mounts).toEqual([
      `type=bind,source=${workingDir},target=${workingDir}`,
      `type=bind,source=${replayRoot},target=${replayRoot},readonly`,
    ]);
    const networkIndex = log.args.indexOf("--network");
    expect(log.args[networkIndex + 1]).toBe("none");
    expect(log.args).not.toContain("--privileged");
    expect(log.args).not.toContain("--device");
  });

  it("reports timeout when the container backend exceeds the fixture budget", async () => {
    const fakeContainer = join(binariesDir, "fake-container.mjs");
    const fakeKota = join(binariesDir, "unused-kota.mjs");
    writeFakeContainerBackend(fakeContainer);
    writeFakeKotaScript(fakeKota, "process.exit(0);\n");
    const executor = createSubprocessExecutor({
      kotaBinaryPath: fakeKota,
      isolationBackend: {
        kind: "container",
        executable: fakeContainer,
        image: "sleep:image",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
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
      workingDir,
      budgetMs: 200,
      executionProfile: preflight,
    });

    expect(outcome.kind).toBe("timeout");
    expect(outcome.runArtifactPath).toBeNull();
  });

  it("reports error when the child exits non-zero", async () => {
    writeTerminalRun(workingDir, "noop", "run-1-noop-fail", "failed");
    const fakeKota = join(binariesDir, "kota-fail.mjs");
    writeFakeKotaScript(fakeKota, "process.exit(3);\n");

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "noop",
      workingDir,
      budgetMs: 5_000,
    });

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toMatch(/status 3/);
      expect(outcome.message).toMatch(/failed/);
    }
  });
});
