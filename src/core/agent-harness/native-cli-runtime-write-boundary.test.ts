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
    const projectDir = mkdtempSync(join(tmpdir(), "kota-native-state-boundary-"));
    roots.push(projectDir);
    mkdirSync(join(projectDir, ".kota"));

    expect(() => nativeCliRuntimeWriteBoundary(projectDir, {
      KOTA_RUN_DIR: join(projectDir, ".kota", "builder-evidence"),
    })).toThrow(/KOTA_RUN_DIR outside its invocation-scoped runtime directory/);
    expect(() => nativeCliRuntimeWriteBoundary(projectDir, {
      KOTA_RUN_TEMP_DIR: join(projectDir, ".kota"),
    })).toThrow(/KOTA_RUN_TEMP_DIR outside its invocation-scoped runtime directory/);
  });

  it("overlays Linux runtime state read-only before reopening assigned roots", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-native-state-linux-"));
    roots.push(projectDir);
    const runtimeRoot = join(projectDir, ".kota");
    const agentRunDir = join(runtimeRoot, "builder-evidence", "run-1");
    const tempRoot = join(runtimeRoot, "tmp", "run-1");
    mkdirSync(agentRunDir, { recursive: true });
    mkdirSync(tempRoot, { recursive: true });
    const boundary = nativeCliRuntimeWriteBoundary(projectDir, {
      KOTA_RUN_DIR: agentRunDir,
      KOTA_RUN_TEMP_DIR: tempRoot,
    });
    expect(boundary).toBeDefined();

    const launch = buildMachineAuthoritySandboxLaunch("/bin/sh", [], {
      cwd: projectDir,
      platform: "linux",
      pathExists: () => true,
      readableRoots: [projectDir],
      writableRoots: [projectDir],
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

  it.runIf(canBootstrapMacosSandbox)(
    "protects daemon state while assigned run roots remain writable",
    async () => {
      const projectDir = mkdtempSync(join(tmpdir(), "kota-native-state-sandbox-"));
      roots.push(projectDir);
      const runtimeRoot = join(projectDir, ".kota");
      const agentRunDir = join(runtimeRoot, "builder-evidence", "run-1");
      const artifactRoot = join(agentRunDir, "artifacts");
      const tempRoot = join(runtimeRoot, "tmp", "run-1");
      const statePath = join(runtimeRoot, "workflow-state.json");
      const artifactPath = join(artifactRoot, "proof.txt");
      const tempPath = join(tempRoot, "scratch.txt");
      mkdirSync(artifactRoot, { recursive: true });
      mkdirSync(tempRoot, { recursive: true });
      writeFileSync(statePath, "preserve\n");

      const result = await withNativeCliSandbox(
        "/bin/sh",
        ["-c", [
          'printf "artifact\\n" > "$ARTIFACT" || exit 20',
          'printf "scratch\\n" > "$SCRATCH" || exit 21',
          'if printf "corrupt\\n" > "$STATE"; then exit 22; fi',
          'if mv "$RUNTIME_ROOT" "$RUNTIME_ROOT.bak"; then exit 23; fi',
        ].join("; ")],
        {
          cwd: projectDir,
          machineAuthorityOwner: "kota",
          writableRoots: [projectDir],
          env: buildNativeCliEnvironment({
            overrides: {
              KOTA_RUN_DIR: agentRunDir,
              KOTA_RUN_ARTIFACT_DIR: artifactRoot,
              KOTA_RUN_TEMP_DIR: tempRoot,
              ARTIFACT: artifactPath,
              SCRATCH: tempPath,
              STATE: statePath,
              RUNTIME_ROOT: runtimeRoot,
            },
          }),
        },
        (sandboxedProcess) => runNativeProcess(projectDir, sandboxedProcess),
      );

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(statePath, "utf8")).toBe("preserve\n");
      expect(readFileSync(artifactPath, "utf8")).toBe("artifact\n");
      expect(readFileSync(tempPath, "utf8")).toBe("scratch\n");
      expect(existsSync(`${runtimeRoot}.bak`)).toBe(false);
    },
  );
});
