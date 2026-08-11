import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExecutableVerifierSandbox,
  resolveExecutableVerifierSandbox,
} from "./executable-verifier-sandbox.js";

export type SubprocessTestDirs = {
  binariesDir: string;
  workingDir: string;
};

export function createSubprocessTestDirs(): SubprocessTestDirs {
  return {
    binariesDir: mkdtempSync(join(tmpdir(), "kota-subprocess-bin-")),
    workingDir: mkdtempSync(join(tmpdir(), "kota-subprocess-work-")),
  };
}

export function cleanupSubprocessTestDirs(dirs: SubprocessTestDirs): void {
  rmSync(dirs.binariesDir, { recursive: true, force: true });
  rmSync(dirs.workingDir, { recursive: true, force: true });
}

export function writeFakeKotaScript(path: string, body: string): void {
  writeFileSync(path, body, "utf-8");
  chmodSync(path, 0o755);
}

export function writeTerminalRun(
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

export function writeFakeContainerBackend(path: string): void {
  writeFakeKotaScript(
    path,
    [
      "#!/usr/bin/env node",
      "import { spawnSync } from 'node:child_process';",
      "import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "if (args[0] === '--version') process.exit(0);",
      "if (args[0] === 'image' && args[1] === 'inspect') {",
      "  process.exit(args[2] === 'missing:image' ? 2 : 0);",
      "}",
      "if (args[0] === 'network' && args[1] === 'inspect') {",
      "  if (args[2] === 'missing-network') process.exit(2);",
      "  const labels = JSON.parse(process.env.KOTA_FAKE_CONTAINER_NETWORK_LABELS ?? '{}');",
      "  const internal = process.env.KOTA_FAKE_CONTAINER_NETWORK_INTERNAL !== 'false';",
      "  console.log(JSON.stringify([{ Internal: internal, Labels: labels }]));",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'rm' && args[1] === '--force') {",
      "  if (process.env.KOTA_FAKE_CONTAINER_REMOVE_LOG) appendFileSync(process.env.KOTA_FAKE_CONTAINER_REMOVE_LOG, `${args[2]}\\n`);",
      "  process.exit(process.env.KOTA_FAKE_CONTAINER_REMOVE_FAIL === '1' ? 73 : 0);",
      "}",
      "if (args[0] !== 'run') process.exit(64);",
      "const env = {};",
      "const envFiles = [];",
      "const envFileModes = [];",
      "const mounts = [];",
      "let workdir = process.cwd();",
      "let image = null;",
      "let entrypoint = null;",
      "let cidFile = null;",
      "let index = 1;",
      "while (index < args.length) {",
      "  const arg = args[index];",
      "  if (arg === '--rm' || arg === '--init' || arg === '--read-only') { index += 1; continue; }",
      "  if (arg === '--mount') { mounts.push(args[index + 1]); index += 2; continue; }",
      "  if (arg === '--network' || arg === '--ipc' || arg === '--pull' || arg === '--cpus' || arg === '--memory-reservation' || arg === '--memory' || arg === '--memory-swap' || arg === '--pids-limit' || arg === '--ulimit' || arg === '--tmpfs' || arg === '--cap-drop' || arg === '--security-opt' || arg === '--user') { index += 2; continue; }",
      "  if (arg === '--cidfile') { cidFile = args[index + 1]; index += 2; continue; }",
      "  if (arg === '--name') { index += 2; continue; }",
      "  if (arg === '--entrypoint') { entrypoint = args[index + 1]; index += 2; continue; }",
      "  if (arg === '--workdir') { workdir = args[index + 1]; index += 2; continue; }",
      "  if (arg === '--env') {",
      "    const raw = args[index + 1];",
      "    const eq = raw.indexOf('=');",
      "    env[raw.slice(0, eq)] = raw.slice(eq + 1);",
      "    index += 2;",
      "    continue;",
      "  }",
      "  if (arg === '--env-file') {",
      "    const envFile = args[index + 1];",
      "    envFiles.push(envFile);",
      "    envFileModes.push((statSync(envFile).mode & 0o777).toString(8).padStart(3, '0'));",
      "    for (const line of readFileSync(envFile, 'utf8').split(/\\r?\\n/)) {",
      "      if (!line || line.startsWith('#')) continue;",
      "      const eq = line.indexOf('=');",
      "      if (eq === -1) { env[line] = process.env[line] ?? ''; continue; }",
      "      env[line.slice(0, eq)] = line.slice(eq + 1);",
      "    }",
      "    index += 2;",
      "    continue;",
      "  }",
      "  image = arg;",
      "  index += 1;",
      "  break;",
      "}",
      "if (cidFile) writeFileSync(cidFile, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');",
      "const command = entrypoint ?? args[index];",
      "const commandArgOffset = entrypoint === null ? index + 1 : index;",
      "if (process.env.KOTA_FAKE_CONTAINER_LOG) {",
      "  appendFileSync(process.env.KOTA_FAKE_CONTAINER_LOG, JSON.stringify({ args, env, envFiles, envFileModes, inheritedOpenAiApiKey: process.env.OPENAI_API_KEY, mounts, workdir, image, command, commandArgs: args.slice(commandArgOffset) }) + '\\n');",
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
      "const commandArgs = args.slice(commandArgOffset);",
      "if (command === 'agy' && commandArgs[0] === 'models' && process.env.KOTA_FAKE_CONTAINER_AGY_MODELS) {",
      "  console.log(process.env.KOTA_FAKE_CONTAINER_AGY_MODELS);",
      "  process.exit(0);",
      "}",
      "if (command === 'node' && process.env.KOTA_FAKE_CONTAINER_NODE_MAX_OLD_SPACE_MB) {",
      "  commandArgs.unshift(`--max-old-space-size=${process.env.KOTA_FAKE_CONTAINER_NODE_MAX_OLD_SPACE_MB}`);",
      "}",
      "if (command === 'node' && process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_PATH === commandArgs[0] && process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_SOURCE) {",
      "  commandArgs[0] = process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_SOURCE;",
      "}",
      "const result = spawnSync(command, commandArgs, {",
      "  cwd: workdir,",
      "  env: { PATH: process.env.PATH, ...env, ...(process.env.KOTA_FAKE_CONTAINER_USE_HOST_PATH === '1' ? { PATH: process.env.PATH } : {}), KOTA_FAKE_CONTAINER_VISIBLE_MOUNTS: JSON.stringify(mountTargets) },",
      "  stdio: ['ignore', 'inherit', 'inherit'],",
      "});",
      "process.exit(result.status ?? 1);",
      "}",
    ].join("\n"),
  );
}

export function createFakeExecutableVerifierSandbox(): {
  sandbox: ExecutableVerifierSandbox;
  cleanup: () => void;
} {
  const runtimeDir = mkdtempSync(join(tmpdir(), "kota-test-verifier-runtime-"));
  const fakeContainer = join(runtimeDir, "fake-container.mjs");
  writeFakeContainerBackend(fakeContainer);
  return {
    sandbox: resolveExecutableVerifierSandbox(
      {
        kind: "container",
        executable: fakeContainer,
        image: "kota-eval:test",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      },
      {
        PATH: process.env.PATH,
        KOTA_FAKE_CONTAINER_USE_HOST_PATH: "1",
      },
    ),
    cleanup: () => rmSync(runtimeDir, { recursive: true, force: true }),
  };
}
