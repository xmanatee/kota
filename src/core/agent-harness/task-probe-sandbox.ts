import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRequiredInheritedSubprocessEnv } from "#core/modules/subprocess-env.js";
import { existingProtectedProjectPaths } from "#core/tools/protected-project-paths.js";
import {
  findExternalHardLinkWriteProtections,
  type WorkspaceWriteProtection,
} from "./task-probe-hard-links.js";
import {
  SANDBOX_CAPABILITY_EVIDENCE,
  SANDBOX_CAPABILITY_PROGRAM,
  SANDBOX_POST_EXEC_ABORT_EVIDENCE,
} from "./task-probe-sandbox-capability-program.js";
import {
  type AvailableTaskProbeSandbox,
  assessLinuxCoreDumpBoundary,
  buildLinuxTaskProbeSandbox,
  type LinuxCoreDumpBoundary,
  type TaskProbeSandbox,
} from "./task-probe-sandbox-spec.js";
import { resolveTaskProbeToolchain } from "./task-probe-toolchain.js";

export {
  type AvailableContainedWorkspaceSandbox,
  type AvailableTaskProbeSandbox,
  assessLinuxCoreDumpBoundary,
  buildLinuxTaskProbeSandbox,
  type ContainedWorkspaceSandbox,
  type LinuxCoreDumpBoundary,
  type TaskProbeSandbox,
  type TaskProbeToolchain,
} from "./task-probe-sandbox-spec.js";

const LINUX_BWRAP_PATHS = ["/usr/bin/bwrap", "/bin/bwrap"] as const;
const LINUX_PRLIMIT_PATHS = ["/usr/bin/prlimit", "/bin/prlimit"] as const;
const LINUX_CORE_PATTERN_PATH = "/proc/sys/kernel/core_pattern";
const SANDBOX_CAPABILITY_TIMEOUT_MS = 5_000;
const DETACHED_DESCENDANT_WITNESS =
  "KOTA_RUNTIME_PROBE_DETACHED_DESCENDANT_SURVIVED";

type SandboxBuilder = (
  workspaceWriteProtections: readonly WorkspaceWriteProtection[],
) => AvailableTaskProbeSandbox;

function sandboxCapabilityResult(
  buildSandbox: SandboxBuilder,
  workspaceDir: string,
  capabilityExecutable: string,
  pnpmExecutable: string,
  workspaceWriteProtections: readonly WorkspaceWriteProtection[],
): SpawnSyncReturns<string> {
  const insideRoot = mkdtempSync(join(workspaceDir, ".kota-probe-capability-"));
  const hardLinkRoot = mkdtempSync(
    join(workspaceDir, ".kota-probe-hard-link-capability-"),
  );
  const outsideRoot = mkdtempSync(join(tmpdir(), "kota-probe-capability-outside-"));
  const outsideMarker = join(outsideRoot, "host-marker");
  const detachedReady = join(insideRoot, "detached-process-ready");
  const outsideLink = join(insideRoot, "outside-link");
  const outsideHardLink = join(hardLinkRoot, "outside-hard-link");
  const relinkedAlias = join(insideRoot, "relinked-outside-hard-link");
  writeFileSync(outsideMarker, "host-only");
  symlinkSync(outsideMarker, outsideLink);
  linkSync(outsideMarker, outsideHardLink);
  try {
    const sandbox = buildSandbox([
      ...workspaceWriteProtections,
      { path: hardLinkRoot, kind: "tree" },
    ]);
    const result = spawnSync(
      sandbox.command,
      [
        ...sandbox.prefixArgs,
        capabilityExecutable,
        "-e",
        SANDBOX_CAPABILITY_PROGRAM,
        join(insideRoot, "inside-marker"),
        outsideMarker,
        outsideLink,
        outsideHardLink,
        relinkedAlias,
        detachedReady,
        String(process.pid),
        pnpmExecutable,
      ],
      {
        cwd: workspaceDir,
        env: {
          ...buildRequiredInheritedSubprocessEnv(),
          HOME: insideRoot,
          TMPDIR: insideRoot,
          NO_COLOR: "1",
        },
        encoding: "utf8",
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024,
        stdio: ["ignore", "pipe", "pipe", "pipe"],
        timeout: SANDBOX_CAPABILITY_TIMEOUT_MS,
      },
    );
    if (readFileSync(outsideMarker, "utf8") !== "host-only") {
      throw new Error(
        "Runtime Probe OS sandbox capability check modified a host inode through an in-project hard link.",
      );
    }
    if ((result.output[3] ?? "").includes(DETACHED_DESCENDANT_WITNESS)) {
      throw new Error(
        "Runtime Probe OS sandbox capability check allowed a detached descendant to survive namespace teardown.",
      );
    }
    return result;
  } finally {
    rmSync(insideRoot, { recursive: true, force: true });
    rmSync(hardLinkRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
}

function capabilityFailure(result: SpawnSyncReturns<string>): string {
  const detail = [result.stdout, result.stderr, result.error?.message]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.length > 0,
    )
    .join("\n")
    .trim();
  const outcome =
    result.signal !== null
      ? `signal ${result.signal}`
      : `status ${result.status ?? "unknown"}`;
  return `Runtime Probe OS sandbox capability check failed (${outcome})${detail ? `: ${detail}` : ""}`;
}

export function resolveTaskProbeSandbox(
  projectDir: string,
  timeoutMs: number,
): TaskProbeSandbox {
  try {
    const workspaceDir = realpathSync(projectDir);
    let buildSandbox: SandboxBuilder | null = null;
    let capabilityExecutable = process.execPath;
    let pnpmExecutable = "";
    let unavailableReason =
      `Runtime Probe execution requires a Linux PID namespace; ${process.platform} ` +
      "does not provide the process-lifetime boundary required to contain detached descendants.";
    if (process.platform === "linux") {
      const bubblewrapPath = LINUX_BWRAP_PATHS.find((path) => existsSync(path));
      const prlimitPath = LINUX_PRLIMIT_PATHS.find((path) => existsSync(path));
      if (bubblewrapPath !== undefined && prlimitPath !== undefined) {
        const coreDumpBoundary: LinuxCoreDumpBoundary =
          assessLinuxCoreDumpBoundary(
            readFileSync(LINUX_CORE_PATTERN_PATH, "utf8"),
          );
        if (coreDumpBoundary.status === "unavailable") {
          return coreDumpBoundary;
        }
        const toolchain = resolveTaskProbeToolchain(workspaceDir);
        if (toolchain.status === "available") {
          const readProtectedPaths = existingProtectedProjectPaths(workspaceDir);
          buildSandbox = (workspaceWriteProtections) =>
            buildLinuxTaskProbeSandbox(
              workspaceDir,
              timeoutMs,
              bubblewrapPath,
              prlimitPath,
              toolchain.toolchain,
              coreDumpBoundary,
              workspaceWriteProtections,
              readProtectedPaths,
            );
          capabilityExecutable = toolchain.toolchain.nodeExecutable;
          pnpmExecutable = toolchain.toolchain.pnpmExecutable;
        } else {
          unavailableReason = toolchain.reason;
        }
      } else {
        unavailableReason =
          "Runtime Probe execution requires Bubblewrap and prlimit to establish an empty root, PID namespace, and hard resource limits.";
      }
    }
    if (buildSandbox === null) {
      return {
        status: "unavailable",
        reason: unavailableReason,
      };
    }

    const workspaceWriteProtections =
      findExternalHardLinkWriteProtections(workspaceDir);
    const capability = sandboxCapabilityResult(
      buildSandbox,
      workspaceDir,
      capabilityExecutable,
      pnpmExecutable,
      workspaceWriteProtections,
    );
    if (
      capability.status !== 0 ||
      !capability.stdout.includes(SANDBOX_CAPABILITY_EVIDENCE) ||
      !capability.stdout.includes(SANDBOX_POST_EXEC_ABORT_EVIDENCE)
    ) {
      return { status: "unavailable", reason: capabilityFailure(capability) };
    }
    return buildSandbox(workspaceWriteProtections);
  } catch (error) {
    return {
      status: "unavailable",
      reason:
        "Runtime Probe OS sandbox capability check could not establish containment: " +
        (error instanceof Error ? error.message : String(error)),
    };
  }
}

/**
 * Resolve the fail-closed OS boundary used for repository-controlled code.
 * Runtime Probes and production-replacement proofs intentionally share this
 * containment mechanism.
 */
export const resolveContainedWorkspaceSandbox = resolveTaskProbeSandbox;
