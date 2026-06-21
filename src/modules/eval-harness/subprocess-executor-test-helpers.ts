import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      "import { appendFileSync, readFileSync, statSync } from 'node:fs';",
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
      "if (args[0] !== 'run') process.exit(64);",
      "const env = {};",
      "const envFiles = [];",
      "const envFileModes = [];",
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
      "if (process.env.KOTA_FAKE_CONTAINER_LOG) {",
      "  appendFileSync(process.env.KOTA_FAKE_CONTAINER_LOG, JSON.stringify({ args, env, envFiles, envFileModes, inheritedOpenAiApiKey: process.env.OPENAI_API_KEY, mounts, workdir, image, command: args[index], commandArgs: args.slice(index + 1) }) + '\\n');",
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
      "  env: { ...env, KOTA_FAKE_CONTAINER_VISIBLE_MOUNTS: JSON.stringify(mountTargets) },",
      "  stdio: ['ignore', 'inherit', 'inherit'],",
      "});",
      "process.exit(result.status ?? 1);",
      "}",
    ].join("\n"),
  );
}
