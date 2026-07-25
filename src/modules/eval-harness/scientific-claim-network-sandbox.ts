import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const NETWORK_PROBE_TIMEOUT_MS = 1_000;
const DARWIN_SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const DARWIN_NETWORK_DENY_PROFILE =
  "(version 1) (allow default) (deny network*)";
const LINUX_UNSHARE_PATHS = ["/usr/bin/unshare", "/bin/unshare"] as const;

function connectionDenialProbe(host: string): string {
  return `
const net = require("node:net");
const socket = net.connect({ host: ${JSON.stringify(host)}, port: 1 });
const timer = setTimeout(() => {
  console.log("KOTA_NETWORK_PROBE_TIMEOUT");
  socket.destroy();
  process.exit(4);
}, 500);
socket.once("connect", () => {
  clearTimeout(timer);
  console.log("KOTA_NETWORK_PROBE_CONNECTED");
  process.exit(3);
});
socket.once("error", (error) => {
  clearTimeout(timer);
  console.log(\`KOTA_NETWORK_PROBE_ERROR:\${error.code}\`);
  process.exit(error.code === "EACCES" || error.code === "EPERM" ? 0 : 2);
});
`;
}

const LOOPBACK_DENIAL_PROBE = connectionDenialProbe("127.0.0.1");

const LINUX_NAMESPACE_PROBE = `
const { networkInterfaces } = require("node:os");
const addresses = Object.values(networkInterfaces()).flat().filter(Boolean);
const external = addresses.filter((address) => !address.internal);
if (external.length > 0) {
  console.log("KOTA_NETWORK_NAMESPACE_EXTERNAL_INTERFACE");
  process.exit(2);
}
console.log("KOTA_NETWORK_NAMESPACE_ISOLATED");
`;

type AvailableScientificClaimNetworkSandbox = {
  kind: "darwin-seatbelt" | "linux-network-namespace";
  command: string;
  prefixArgs: readonly string[];
  evidence: string;
};

export type ScientificClaimNetworkSandbox =
  | AvailableScientificClaimNetworkSandbox
  | {
      kind: "unavailable";
      evidence: string;
      issue: string;
    };

export type ScientificClaimSandboxExecution =
  | {
      started: true;
      isolation: AvailableScientificClaimNetworkSandbox;
      result: SpawnSyncReturns<string>;
    }
  | {
      started: false;
      issue: string;
    };

function probe(
  command: string,
  args: readonly string[],
): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    encoding: "utf8",
    env: { LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
    maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: NETWORK_PROBE_TIMEOUT_MS,
  });
}

function probePassed(
  result: SpawnSyncReturns<string>,
  evidence: string,
): boolean {
  return result.status === 0 && result.stdout.includes(evidence);
}

function resolveDarwinSeatbelt(): ScientificClaimNetworkSandbox | null {
  if (process.platform !== "darwin" || !existsSync(DARWIN_SANDBOX_EXEC)) {
    return null;
  }
  const prefixArgs = ["-p", DARWIN_NETWORK_DENY_PROFILE] as const;
  const result = probe(DARWIN_SANDBOX_EXEC, [
    ...prefixArgs,
    process.execPath,
    "-e",
    LOOPBACK_DENIAL_PROBE,
  ]);
  if (!probePassed(result, "KOTA_NETWORK_PROBE_ERROR:EPERM")) return null;
  return {
    kind: "darwin-seatbelt",
    command: DARWIN_SANDBOX_EXEC,
    prefixArgs,
    evidence: "macOS sandbox-exec network denial",
  };
}

function resolveLinuxNetworkNamespace(): ScientificClaimNetworkSandbox | null {
  if (process.platform !== "linux") return null;
  const command = LINUX_UNSHARE_PATHS.find((path) => existsSync(path));
  if (command === undefined) return null;
  const prefixArgs = [
    "--user",
    "--map-root-user",
    "--net",
    "--",
  ] as const;
  const result = probe(command, [
    ...prefixArgs,
    process.execPath,
    "-e",
    LINUX_NAMESPACE_PROBE,
  ]);
  if (!probePassed(result, "KOTA_NETWORK_NAMESPACE_ISOLATED")) return null;
  return {
    kind: "linux-network-namespace",
    command,
    prefixArgs,
    evidence: "Linux unshare network namespace",
  };
}

/**
 * Resolve a network boundary before any agent-produced analyzer is executed.
 * Merely observing a denied connection in the parent is insufficient: the
 * analyzer always receives a dedicated child sandbox or does not run.
 */
export function resolveScientificClaimNetworkSandbox(): ScientificClaimNetworkSandbox {
  const sandbox =
    resolveDarwinSeatbelt() ?? resolveLinuxNetworkNamespace();
  return (
    sandbox ?? {
      kind: "unavailable",
      evidence: "network isolation unavailable",
      issue:
        `scientific-claim analyzer network isolation unavailable on ${process.platform}; ` +
        "refusing to execute agent-produced JavaScript",
    }
  );
}

export function spawnScientificClaimAnalyzer(
  isolation: ScientificClaimNetworkSandbox,
  nodeArgs: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    maxBuffer: number;
    timeout: number;
  },
): ScientificClaimSandboxExecution {
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
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  };
}
