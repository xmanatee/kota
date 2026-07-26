import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  resolveLinuxAnalyzerRuntimeFiles,
  spawnScientificClaimLinuxAnalyzer,
} from "./scientific-claim-linux-filesystem-boundary.js";
import { probeScientificClaimAnalyzerBoundary } from "./scientific-claim-sandbox-capabilities.js";

const DARWIN_SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const DARWIN_ANALYZER_PROFILE =
  "(version 1) (allow default) (deny network*) (deny signal)";
const LINUX_UNSHARE_PATHS = ["/usr/bin/unshare", "/bin/unshare"] as const;

type AvailableScientificClaimAnalyzerSandbox =
  | {
      kind: "darwin-seatbelt";
      command: string;
      prefixArgs: readonly string[];
      evidence: string;
    }
  | {
      kind: "linux-disposable-root-namespaces";
      command: string;
      prefixArgs: readonly string[];
      runtimeFiles: readonly string[];
      evidence: string;
    };

export type ScientificClaimAnalyzerSandbox =
  | AvailableScientificClaimAnalyzerSandbox
  | {
      kind: "unavailable";
      evidence: string;
      issue: string;
    };

export type ScientificClaimAnalyzerExecution =
  | {
      started: true;
      isolation: AvailableScientificClaimAnalyzerSandbox;
      result: SpawnSyncReturns<string>;
    }
  | {
      started: false;
      issue: string;
    };

export type ScientificClaimAnalyzerInvocation = {
  nodeOptions: readonly string[];
  scriptPath: string;
  scriptArgs: readonly string[];
};

function resolveDarwinSeatbelt(): ScientificClaimAnalyzerSandbox | null {
  if (process.platform !== "darwin" || !existsSync(DARWIN_SANDBOX_EXEC)) {
    return null;
  }
  const prefixArgs = ["-p", DARWIN_ANALYZER_PROFILE] as const;
  const capability = probeScientificClaimAnalyzerBoundary({
    kind: "darwin-loopback-denial",
    command: DARWIN_SANDBOX_EXEC,
    prefixArgs,
  });
  if (!capability.networkDenied || !capability.hostSignalsDenied) {
    return {
      kind: "unavailable",
      evidence: "macOS analyzer process isolation unavailable",
      issue: capability.issues.join("; "),
    };
  }
  return {
    kind: "darwin-seatbelt",
    command: DARWIN_SANDBOX_EXEC,
    prefixArgs,
    evidence: "macOS sandbox-exec network and host-signal denial",
  };
}

function resolveLinuxNamespaces(): ScientificClaimAnalyzerSandbox | null {
  if (process.platform !== "linux") return null;
  const command = LINUX_UNSHARE_PATHS.find((path) => existsSync(path));
  if (command === undefined) return null;
  let runtimeFiles: readonly string[];
  try {
    runtimeFiles = resolveLinuxAnalyzerRuntimeFiles();
  } catch (error) {
    return {
      kind: "unavailable",
      evidence: "Linux analyzer process isolation unavailable",
      issue: error instanceof Error ? error.message : String(error),
    };
  }
  const prefixArgs = [
    "--user",
    "--map-root-user",
    "--mount",
    "--net",
    "--pid",
    "--fork",
    "--kill-child",
    "--",
  ] as const;
  const capability = probeScientificClaimAnalyzerBoundary({
    kind: "linux-network-namespace",
    command,
    prefixArgs,
    runtimeFiles,
  });
  if (
    !capability.networkDenied ||
    !capability.hostSignalsDenied ||
    !capability.pathnameUnixSocketDenied
  ) {
    return {
      kind: "unavailable",
      evidence: "Linux analyzer process isolation unavailable",
      issue: capability.issues.join("; "),
    };
  }
  return {
    kind: "linux-disposable-root-namespaces",
    command,
    prefixArgs,
    runtimeFiles,
    evidence:
      "Linux unshare file-closed disposable root, PID, proc, and network namespaces",
  };
}

/**
 * Resolve network and host-process isolation before agent-produced code runs.
 * Linux candidates must additionally hide host pathname Unix sockets behind
 * their disposable filesystem root.
 */
export function resolveScientificClaimAnalyzerSandbox(): ScientificClaimAnalyzerSandbox {
  const sandbox = resolveDarwinSeatbelt() ?? resolveLinuxNamespaces();
  return (
    sandbox ?? {
      kind: "unavailable",
      evidence: "analyzer process isolation unavailable",
      issue:
        `scientific-claim analyzer process/network isolation unavailable on ${process.platform}; ` +
        "refusing to execute agent-produced JavaScript",
    }
  );
}

export function spawnScientificClaimAnalyzer(
  isolation: ScientificClaimAnalyzerSandbox,
  invocation: ScientificClaimAnalyzerInvocation,
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    maxBuffer: number;
    readOnlyPaths: readonly string[];
    timeout: number;
    writablePaths: readonly string[];
  },
): ScientificClaimAnalyzerExecution {
  if (isolation.kind === "unavailable") {
    return { started: false, issue: isolation.issue };
  }
  const { readOnlyPaths, writablePaths, ...spawnOptions } = options;
  if (isolation.kind === "linux-disposable-root-namespaces") {
    return {
      started: true,
      isolation,
      result: spawnScientificClaimLinuxAnalyzer({
        command: isolation.command,
        prefixArgs: isolation.prefixArgs,
        runtimeFiles: isolation.runtimeFiles,
        readOnlyPaths,
        writablePaths,
        nodeOptions: invocation.nodeOptions,
        scriptPath: invocation.scriptPath,
        scriptArgs: invocation.scriptArgs,
        options: spawnOptions,
      }),
    };
  }
  return {
    started: true,
    isolation,
    result: spawnSync(
      isolation.command,
      [
        ...isolation.prefixArgs,
        process.execPath,
        ...invocation.nodeOptions,
        invocation.scriptPath,
        ...invocation.scriptArgs,
      ],
      {
        ...spawnOptions,
        encoding: "utf8",
        killSignal: "SIGKILL",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  };
}
