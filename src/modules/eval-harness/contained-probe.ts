import { createHash } from "node:crypto";
import { lstatSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { json } from "node:stream/consumers";
import { z } from "zod";
import { listAnchoredDirectory, readAnchoredTextFiles } from "#core/util/filesystem/anchored-files.js";
import type { WorkflowBlockingOperationContext } from "#core/workflow/blocking-operation.js";
import { createWorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import { parseConstrainedProbeCommand } from "#modules/autonomy/task-probe-command.js";
import { runTaskProbeInSandbox } from "#modules/autonomy/task-probe-runner.js";
import { containerKotaDistDir, containerRunArgs } from "./subprocess-executor-command.js";
import { containerExecutionProfileCanRun, preflightExecutionProfile } from "./subprocess-executor-preflight.js";
import type { ContainerIsolationBackend } from "./subprocess-executor-types.js";

function sourcePathAllowed(path: string): boolean {
  return path.length > 0 && path.split("/").every((part) =>
    /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(part) && !["node_modules", "dist"].includes(part));
}
export const probeProfileSchema = z.object({
  command: z.string().min(1).transform((command) => {
    const parsed = parseConstrainedProbeCommand(command);
    if (parsed.args[0] === "kota") throw new Error("Deterministic probes cannot run model evaluations");
    return command;
  }),
  sourcePaths: z.array(z.string().refine(sourcePathAllowed, "Expected a relative source path without hidden/runtime entries")).min(1),
}).strict();
export type ContainedProbeProfile = z.infer<typeof probeProfileSchema>;

const transferredSourceSchema = z.object({
  files: z.array(z.object({ path: z.string().refine(sourcePathAllowed), content: z.string() }).strict()),
  timeoutMs: z.number().int().positive(),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

// The image-side receiver validates the source before any materialization or
// execution. The streaming consumer preserves characters split across chunks.
export async function receiveProbeSource(stream: Parameters<typeof json>[0]) {
  const source = transferredSourceSchema.parse(await json(stream));
  if (createHash("sha256").update(JSON.stringify(source.files)).digest("hex") !== source.sourceDigest)
    throw new Error("Probe source digest changed during transfer");
  return source;
}

// Read through the shared descriptor-anchored owner. Candidate links, hard links,
// directory replacement and runtime/credential trees cannot authorize host reads.
export async function collectProbeSource(root: string, paths: string[], signal: AbortSignal) {
  const selected = new Set<string>();
  let visited = 0;
  function visit(path: string, depth = 0): void {
    signal.throwIfAborted();
    if (++visited > 10_000 || depth > 32) throw new Error("Probe source exceeds traversal limit");
    if (!sourcePathAllowed(path)) throw new Error(`Probe source path is forbidden: ${path}`);
    if (lstatSync(join(root, path)).isDirectory()) {
      for (const entry of listAnchoredDirectory({ rootPath: root, boundaryDir: root, directoryPath: join(root, path) })) {
        if (sourcePathAllowed(entry.name)) visit(`${path}/${entry.name}`, depth + 1);
      }
    } else selected.add(path);
  }
  for (const path of paths) visit(path);
  const names = [...selected].sort();
  const files: Array<{ path: string; content: string }> = [];
  let bytes = 0;
  for (let offset = 0; offset < names.length; offset += 32) {
    const batch = names.slice(offset, offset + 32);
    const results = await readAnchoredTextFiles(batch.map((path) => ({ rootPath: root, boundaryDir: root, filePath: join(root, path), maxBytes: 128 * 1024 })), signal);
    for (const [index, result] of results.entries()) {
      const path = batch[index]!;
      if (!result.ok || !result.file) throw new Error(`Probe source ${path}: ${result.ok ? "missing file" : result.reason}`);
      const content = result.file.content;
      if (content.includes("\0")) throw new Error(`Probe source must be UTF-8 text without NUL bytes: ${path}`);
      bytes += Buffer.byteLength(content);
      if (bytes > 32 * 1024 * 1024) throw new Error("Probe source exceeds 32 MiB limit");
      files.push({ path, content });
    }
  }
  return { files, digest: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}

// Runs only in the host-selected image. The immutable image supplies the runner;
// candidate code is first executed by the existing contained-workspace owner.
const PROBE_BOOTSTRAP = `
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [dist, workspace, executable, ...args] = process.argv.slice(1);
if (process.platform !== 'linux') throw new Error('Probe image must run Linux');
const { assessLinuxCoreDumpBoundary } = await import(pathToFileURL(join(dist, 'core/agent-harness/task-probe-sandbox-spec.js')));
const boundary = assessLinuxCoreDumpBoundary(readFileSync('/proc/sys/kernel/core_pattern', 'utf8'));
if (boundary.status !== 'available') throw new Error(boundary.reason);
const { receiveProbeSource } = await import(pathToFileURL(join(dist, 'modules/eval-harness/contained-probe.js')));
const { files, timeoutMs } = await receiveProbeSource(process.stdin);
cpSync(join(dirname(dist), 'node_modules'), join(workspace, 'node_modules'), { recursive: true, verbatimSymlinks: true });
for (const file of files) {
  const target = join(workspace, file.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content, { flag: 'wx', mode: 0o644 });
}
const { buildTaskProbeEnv } = await import(pathToFileURL(join(dist, 'modules/autonomy/task-probe-runner.js')));
const { createWorkflowCommandRunner } = await import(pathToFileURL(join(dist, 'core/workflow/workflow-command.js')));
const runtimeHome = join(workspace, '.probe-home'); mkdirSync(runtimeHome);
try {
  const result = await createWorkflowCommandRunner({ cwd: workspace })({ command: executable, args, timeoutMs, env: buildTaskProbeEnv(runtimeHome), envMode: 'replace' });
  process.stdout.write(result.stdout.text); process.stderr.write(result.stderr.text);
} catch (error) {
  process.stderr.write(error.message); process.exitCode = 1;
}
`;

export type ContainedProbeResult = { ok: boolean; message: string; output: string; sourceDigest: string; image: string };
export async function runContainedProbe(input: {
  sourceRoot: string;
  probe: ContainedProbeProfile;
  backend: ContainerIsolationBackend;
  timeoutMs: number;
  cpuCores: number;
  memoryMB: number;
  artifactDir: string;
}, context: WorkflowBlockingOperationContext): Promise<ContainedProbeResult> {
  context.signal.throwIfAborted();
  const parsed = parseConstrainedProbeCommand(input.probe.command);
  const timeoutMs = Math.min(input.timeoutMs, parsed.maxTimeoutMs);
  const profile = preflightExecutionProfile(input.backend, {
    hostClass: "contained-task-probe", cpuAllocationCores: input.cpuCores, cpuKillThresholdCores: input.cpuCores,
    memoryAllocationMB: input.memoryMB, memoryKillThresholdMB: input.memoryMB,
  }, undefined);
  if (!containerExecutionProfileCanRun(profile)) throw new Error(profile.diagnostics.map((entry) => entry.message).join("\n"));
  const source = await collectProbeSource(input.sourceRoot, input.probe.sourcePaths, context.signal);
  writeFileSync(join(input.artifactDir, "source.json"), JSON.stringify({ sourceRoot: input.sourceRoot, digest: source.digest, files: source.files.map(({ path, content }) => ({ path, sha256: createHash("sha256").update(content).digest("hex") })) }, null, 2));
  const dist = containerKotaDistDir(input.backend);
  const workingDir = posix.join(dirname(dist), "probe-workspace");
  const args = containerRunArgs({ backend: input.backend, executionProfile: profile, workingDir, transport: "stdin-source", command: "node", commandArgs: ["--input-type=module", "--eval", PROBE_BOOTSTRAP, dist, workingDir] });
  const runCommand = createWorkflowCommandRunner({ cwd: input.artifactDir, signal: context.signal, onProcessSpawn: context.onProcessSpawn });
  const identity = { sourceDigest: source.digest, image: input.backend.image };
    const result = await runTaskProbeInSandbox(
      { command: input.probe.command, executable: parsed.executable, args: parsed.args, timeoutMs },
      input.artifactDir,
      { status: "available", kind: "linux-oci-container", processBoundary: "pid-namespace", command: input.backend.executable, prefixArgs: args, probeExecutable: parsed.executable, evidence: "Offline container with private PID namespace, no host mounts, read-only image and enforced resource limits; Linux and core-dump policy checked before candidate launch" },
      (command) => runCommand({ ...command, env: process.env, stdin: JSON.stringify({ files: source.files, timeoutMs, sourceDigest: source.digest }) }),
    );
    writeFileSync(join(input.artifactDir, "probe.json"), JSON.stringify(result, null, 2));
    return { ...identity, ok: result.verdict === "pass", message: result.verdict === "pass" ? "Contained Linux task probe passed" : "Contained Linux task probe failed", output: result.output };
}
