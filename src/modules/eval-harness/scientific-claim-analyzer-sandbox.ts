import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { probeScientificClaimAnalyzerBoundary } from "./scientific-claim-sandbox-capabilities.js";

const DARWIN_SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const DARWIN_ANALYZER_PROFILE =
  "(version 1) (allow default) (deny network*) (deny signal)";
const LINUX_UNSHARE_PATHS = ["/usr/bin/unshare", "/bin/unshare"] as const;

type AvailableScientificClaimAnalyzerSandbox = {
  kind: "darwin-seatbelt" | "linux-pid-network-namespaces";
  command: string;
  prefixArgs: readonly string[];
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

function resolveDarwinSeatbelt(): ScientificClaimAnalyzerSandbox | null {
  if (process.platform !== "darwin" || !existsSync(DARWIN_SANDBOX_EXEC)) {
    return null;
  }
  const prefixArgs = ["-p", DARWIN_ANALYZER_PROFILE] as const;
  const capability = probeScientificClaimAnalyzerBoundary(
    DARWIN_SANDBOX_EXEC,
    prefixArgs,
    "darwin-loopback-denial",
  );
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
  const prefixArgs = [
    "--user",
    "--map-root-user",
    "--net",
    "--pid",
    "--fork",
    "--mount-proc",
    "--kill-child",
    "--",
  ] as const;
  const capability = probeScientificClaimAnalyzerBoundary(
    command,
    prefixArgs,
    "linux-network-namespace",
  );
  if (!capability.networkDenied || !capability.hostSignalsDenied) {
    return {
      kind: "unavailable",
      evidence: "Linux analyzer process isolation unavailable",
      issue: capability.issues.join("; "),
    };
  }
  return {
    kind: "linux-pid-network-namespaces",
    command,
    prefixArgs,
    evidence: "Linux unshare PID, proc, and network namespaces",
  };
}

/**
 * Resolve both network and host-process isolation before agent-produced code
 * runs. Each candidate boundary must fail a live network probe and a live
 * attempt to SIGKILL a disposable same-UID host sentinel.
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
  nodeArgs: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    maxBuffer: number;
    timeout: number;
  },
): ScientificClaimAnalyzerExecution {
  if (isolation.kind === "unavailable") {
    return { started: false, issue: isolation.issue };
  }
  return {
    started: true,
    isolation,
    result: spawnSync(
      isolation.command,
      [...isolation.prefixArgs, process.execPath, ...nodeArgs],
      {
        ...options,
        encoding: "utf8",
        killSignal: "SIGKILL",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  };
}
