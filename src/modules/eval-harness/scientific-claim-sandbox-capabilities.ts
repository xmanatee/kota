import {
  runScientificClaimCapabilityProbe as probe,
  describeScientificClaimCapabilityProbeFailure as probeFailure,
  scientificClaimCapabilityProbePassed as probePassed,
} from "./scientific-claim-capability-probe.js";
import { probeScientificClaimPathnameUnixSocketIsolation } from "./scientific-claim-pathname-socket-capability.js";

const HOST_SIGNAL_DENIED = "KOTA_HOST_SIGNAL_DENIED";
const HOST_SIGNAL_ISOLATED = "KOTA_HOST_SIGNAL_ISOLATED";

const LOOPBACK_DENIAL_PROBE = `
const net = require("node:net");
const socket = net.connect({ host: "127.0.0.1", port: 1 });
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

const HOST_SIGNAL_ATTACK = `
const targetPid = Number(process.argv[1]);
try {
  process.kill(targetPid, "SIGKILL");
  console.log("KOTA_HOST_SIGNAL_DELIVERED");
  process.exit(3);
} catch (error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  console.log(\`${HOST_SIGNAL_DENIED}:\${code ?? "UNKNOWN"}\`);
  process.exit(code === "EPERM" || code === "ESRCH" ? 0 : 4);
}
`;

const HOST_SIGNAL_PROBE_CONTROLLER = `
const { spawn, spawnSync } = require("node:child_process");
const command = process.argv[1];
const prefixArgs = JSON.parse(process.argv[2]);
const attack = process.argv[3];
const sentinel = spawn(
  process.execPath,
  [
    "-e",
    'process.send("ready"); setTimeout(() => process.exit(0), 1500); setInterval(() => {}, 1000)',
  ],
  { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] },
);
let finished = false;
const deadline = setTimeout(() => finish(5, "KOTA_HOST_SIGNAL_PROBE_TIMEOUT"), 1000);

function finish(status, evidence) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  if (sentinel.pid !== undefined && sentinel.exitCode === null) {
    try {
      process.kill(sentinel.pid, "SIGKILL");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(\`KOTA_HOST_SIGNAL_SENTINEL_CLEANUP_FAILED:\${message}\`);
    }
  }
  console.log(evidence);
  setTimeout(() => process.exit(status), 10);
}

sentinel.once("error", (error) => {
  finish(6, \`KOTA_HOST_SIGNAL_SENTINEL_ERROR:\${error.message}\`);
});
sentinel.once("message", () => {
  const result = spawnSync(
    command,
    [...prefixArgs, process.execPath, "-e", attack, String(sentinel.pid)],
    {
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 500,
    },
  );
  setTimeout(() => {
    const sentinelSurvived =
      sentinel.exitCode === null && sentinel.signalCode === null;
    const signalDenied =
      result.status === 0 && result.stdout.includes(${JSON.stringify(HOST_SIGNAL_DENIED)});
    const diagnostics = [result.stdout, result.stderr, result.error?.message]
      .filter(Boolean)
      .join("\\n")
      .trim();
    finish(
      sentinelSurvived && signalDenied ? 0 : 2,
      sentinelSurvived && signalDenied
        ? ${JSON.stringify(HOST_SIGNAL_ISOLATED)}
        : \`KOTA_HOST_SIGNAL_BOUNDARY_FAILED:\${diagnostics}\`,
    );
  }, 50);
});
`;

export type ScientificClaimHostSignalProbe =
  | { denied: true }
  | { denied: false; issue: string };

export function probeScientificClaimHostSignalIsolation(
  command: string,
  prefixArgs: readonly string[],
): ScientificClaimHostSignalProbe {
  const result = probe(process.execPath, [
    "-e",
    HOST_SIGNAL_PROBE_CONTROLLER,
    command,
    JSON.stringify(prefixArgs),
    HOST_SIGNAL_ATTACK,
  ]);
  return probePassed(result, HOST_SIGNAL_ISOLATED)
    ? { denied: true }
    : {
        denied: false,
        issue: probeFailure("host-signal capability probe", result),
      };
}

export type ScientificClaimNetworkProbe =
  | {
      kind: "darwin-loopback-denial";
      command: string;
      prefixArgs: readonly string[];
    }
  | {
      kind: "linux-network-namespace";
      command: string;
      prefixArgs: readonly string[];
      runtimeFiles: readonly string[];
    };

export type ScientificClaimAnalyzerBoundaryProbe = {
  networkDenied: boolean;
  hostSignalsDenied: boolean;
  pathnameUnixSocketDenied: boolean;
  issues: string[];
};

export function probeScientificClaimAnalyzerBoundary(
  boundary: ScientificClaimNetworkProbe,
): ScientificClaimAnalyzerBoundaryProbe {
  const [networkProbe, networkEvidence] =
    boundary.kind === "darwin-loopback-denial"
      ? [LOOPBACK_DENIAL_PROBE, "KOTA_NETWORK_PROBE_ERROR:EPERM"]
      : [LINUX_NAMESPACE_PROBE, "KOTA_NETWORK_NAMESPACE_ISOLATED"];
  const networkResult = probe(boundary.command, [
    ...boundary.prefixArgs,
    process.execPath,
    "-e",
    networkProbe,
  ]);
  const hostSignalProbe = probeScientificClaimHostSignalIsolation(
    boundary.command,
    boundary.prefixArgs,
  );
  const pathnameUnixSocketProbe =
    boundary.kind === "linux-network-namespace"
      ? probeScientificClaimPathnameUnixSocketIsolation({
          command: boundary.command,
          prefixArgs: boundary.prefixArgs,
          runtimeFiles: boundary.runtimeFiles,
        })
      : null;
  const networkDenied = probePassed(networkResult, networkEvidence);
  const hostSignalsDenied = hostSignalProbe.denied;
  const pathnameUnixSocketDenied = pathnameUnixSocketProbe?.denied ?? true;
  return {
    networkDenied,
    hostSignalsDenied,
    pathnameUnixSocketDenied,
    issues: [
      ...(networkDenied
        ? []
        : [probeFailure("network-isolation capability probe", networkResult)]),
      ...(hostSignalsDenied ? [] : [hostSignalProbe.issue]),
      ...(pathnameUnixSocketProbe === null || pathnameUnixSocketProbe.denied
        ? []
        : [pathnameUnixSocketProbe.issue]),
    ],
  };
}
