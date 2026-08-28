import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMachineAuthoritySandboxLaunch } from "./machine-authority-sandbox.js";
import { buildNativeCliEnvironment } from "./native-cli-environment.js";
import { nativeCliRuntimeWriteBoundary } from "./native-cli-runtime-write-boundary.js";
import {
  type NativeCliSandboxProcess,
  withNativeCliSandbox,
} from "./native-cli-sandbox.js";

const roots: string[] = [];
const canBootstrapMacosSandbox = process.platform === "darwin" &&
  spawnSync(
    "/usr/bin/sandbox-exec",
    ["-p", "(version 1)\n(allow default)", "/usr/bin/true"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).status === 0;

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function runNativeProcess(
  cwd: string,
  process: NativeCliSandboxProcess,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.command, process.args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (status) => resolve({
      status,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

describe("native CLI runtime write boundary", () => {
  it("rejects roots broader than one assigned invocation", () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-native-state-boundary-"));
    roots.push(scopeRoot);
    mkdirSync(join(scopeRoot, ".kota"));

    expect(() => nativeCliRuntimeWriteBoundary(join(scopeRoot, ".kota"), {
      KOTA_RUN_DIR: join(scopeRoot, ".kota", "builder-evidence"),
    })).toThrow(/KOTA_RUN_DIR outside its run-owned runtime directories/);
    expect(() => nativeCliRuntimeWriteBoundary(join(scopeRoot, ".kota"), {
      KOTA_RUN_TEMP_DIR: join(scopeRoot, ".kota"),
    })).toThrow(/KOTA_RUN_TEMP_DIR outside its run-owned runtime directories/);
  });

  it("overlays Linux runtime state read-only before reopening assigned roots", () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-native-state-linux-"));
    roots.push(scopeRoot);
    const runtimeRoot = join(scopeRoot, ".kota");
    const agentRunDir = join(runtimeRoot, "builder-evidence", "run-1");
    const tempRoot = join(runtimeRoot, "tmp", "run-1");
    mkdirSync(agentRunDir, { recursive: true });
    mkdirSync(tempRoot, { recursive: true });
    const boundary = nativeCliRuntimeWriteBoundary(
      runtimeRoot,
      {
        KOTA_RUN_DIR: agentRunDir,
        KOTA_RUN_TEMP_DIR: tempRoot,
      },
      [agentRunDir, tempRoot],
    );
    expect(boundary).toBeDefined();

    const launch = buildMachineAuthoritySandboxLaunch("/bin/sh", [], {
      cwd: scopeRoot,
      platform: "linux",
      pathExists: () => true,
      readableRoots: [scopeRoot],
      writableRoots: [scopeRoot],
      writeBoundaries: [boundary!],
    });
    expect(launch.ok).toBe(true);
    if (!launch.ok) return;
    const mountIndex = (kind: "--bind" | "--ro-bind", path: string) =>
      launch.args.findIndex((arg, index) =>
        arg === kind && launch.args[index + 1] === path && launch.args[index + 2] === path
      );
    const protectedIndex = mountIndex("--ro-bind", runtimeRoot);
    expect(protectedIndex).toBeGreaterThan(-1);
    expect(mountIndex("--bind", agentRunDir)).toBeGreaterThan(protectedIndex);
    expect(mountIndex("--bind", tempRoot)).toBeGreaterThan(protectedIndex);
  });

  it("reopens only the isolated per-run agent output root under runtime state", () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-native-agent-scope-"));
    roots.push(scopeRoot);
    const runtimeRoot = join(scopeRoot, ".kota");
    const runStore = join(runtimeRoot, "runs");
    const reviewerOutput = join(runStore, "run-1", "agent-output");
    mkdirSync(reviewerOutput, { recursive: true });

    const boundary = nativeCliRuntimeWriteBoundary(
      runtimeRoot,
      {},
      [reviewerOutput],
    );
    expect(boundary?.writableDescendants).toEqual([reviewerOutput]);

    const launch = buildMachineAuthoritySandboxLaunch("/bin/sh", [], {
      cwd: scopeRoot,
      platform: "linux",
      pathExists: () => true,
      readableRoots: [scopeRoot],
      writableRoots: [reviewerOutput],
      writeBoundaries: [boundary!],
    });
    expect(launch.ok).toBe(true);
    if (!launch.ok) return;
    expect(launch.args).toContain(reviewerOutput);
    expect(launch.args).not.toContain(join(runStore, "run-1"));
    const runStoreBind = launch.args.findIndex((arg, index) =>
      arg === "--bind" && launch.args[index + 1] === runStore
    );
    expect(runStoreBind).toBe(-1);
  });

  it.runIf(canBootstrapMacosSandbox)(
    "protects daemon state while assigned run roots remain writable",
    async () => {
      const scopeRoot = mkdtempSync(join(tmpdir(), "kota-native-state-sandbox-"));
      roots.push(scopeRoot);
      const runtimeRoot = join(scopeRoot, ".kota");
      const workspaceRoot = join(runtimeRoot, "runtime", "worktrees", "run-1");
      const agentRunDir = join(runtimeRoot, "builder-evidence", "run-1");
      const artifactRoot = join(agentRunDir, "artifacts");
      const tempRoot = join(runtimeRoot, "tmp", "run-1");
      const statePath = join(runtimeRoot, "runtime-owned.json");
      const artifactPath = join(artifactRoot, "proof.txt");
      const tempPath = join(tempRoot, "scratch.txt");
      const workspacePath = join(workspaceRoot, "change.txt");
      mkdirSync(workspaceRoot, { recursive: true });
      mkdirSync(artifactRoot, { recursive: true });
      mkdirSync(tempRoot, { recursive: true });
      writeFileSync(statePath, "preserve\n");

      const result = await withNativeCliSandbox(
        "/bin/sh",
        ["-c", [
          'printf "artifact\\n" > "$ARTIFACT" || exit 20',
          'printf "scratch\\n" > "$SCRATCH" || exit 21',
          'printf "change\\n" > "$WORKSPACE_FILE" || exit 24',
          'if printf "corrupt\\n" > "$STATE"; then exit 22; fi',
          'if mv "$RUNTIME_ROOT" "$RUNTIME_ROOT.bak"; then exit 23; fi',
        ].join("; ")],
        {
          cwd: workspaceRoot,
          runtimeStateRoot: runtimeRoot,
          machineAuthorityOwner: "kota",
          writableRoots: [workspaceRoot],
          runtimeWritableRoots: [agentRunDir, artifactRoot, tempRoot],
          env: buildNativeCliEnvironment({
            overrides: {
              KOTA_RUN_DIR: agentRunDir,
              KOTA_RUN_ARTIFACT_DIR: artifactRoot,
              KOTA_RUN_TEMP_DIR: tempRoot,
              ARTIFACT: artifactPath,
              SCRATCH: tempPath,
              WORKSPACE_FILE: workspacePath,
              STATE: statePath,
              RUNTIME_ROOT: runtimeRoot,
            },
          }),
        },
        (sandboxedProcess) => runNativeProcess(workspaceRoot, sandboxedProcess),
      );

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(statePath, "utf8")).toBe("preserve\n");
      expect(readFileSync(artifactPath, "utf8")).toBe("artifact\n");
      expect(readFileSync(tempPath, "utf8")).toBe("scratch\n");
      expect(readFileSync(workspacePath, "utf8")).toBe("change\n");
      expect(existsSync(`${runtimeRoot}.bak`)).toBe(false);
    },
  );
});
