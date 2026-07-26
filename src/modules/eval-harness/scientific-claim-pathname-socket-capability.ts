import {
  describeScientificClaimCapabilityProbeFailure,
  runScientificClaimCapabilityProbe,
  scientificClaimCapabilityProbePassed,
} from "./scientific-claim-capability-probe.js";
import { LINUX_ANALYZER_FILESYSTEM_BOUNDARY } from "./scientific-claim-linux-filesystem-boundary.js";

const PATHNAME_UNIX_SOCKET_DENIED = "KOTA_PATHNAME_UNIX_SOCKET_DENIED";
const PATHNAME_UNIX_SOCKET_ISOLATED = "KOTA_PATHNAME_UNIX_SOCKET_ISOLATED";

const PATHNAME_UNIX_SOCKET_ATTACK = `
const net = require("node:net");
const socketPath = process.argv[1];
const socket = net.connect(socketPath);
const timer = setTimeout(() => {
  console.log("KOTA_PATHNAME_UNIX_SOCKET_TIMEOUT");
  socket.destroy();
  process.exit(4);
}, 500);
socket.once("connect", () => {
  clearTimeout(timer);
  console.log("KOTA_PATHNAME_UNIX_SOCKET_CONNECTED");
  socket.destroy();
  process.exit(3);
});
socket.once("error", (error) => {
  clearTimeout(timer);
  console.log(\`${PATHNAME_UNIX_SOCKET_DENIED}:\${error.code}\`);
  process.exit(
    error.code === "ENOENT" || error.code === "EACCES" || error.code === "EPERM"
      ? 0
      : 2,
  );
});
`;

const PATHNAME_UNIX_SOCKET_PROBE_CONTROLLER = `
const { spawnSync } = require("node:child_process");
const { mkdtempSync, realpathSync, rmSync } = require("node:fs");
const { createServer } = require("node:net");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const command = process.argv[1];
const prefixArgs = JSON.parse(process.argv[2]);
const boundaryScript = process.argv[3];
const attack = process.argv[4];
const runtimeFiles = JSON.parse(process.argv[5]);
const workingDir = realpathSync(mkdtempSync(join(tmpdir(), "kota-socket-work-")));
const sandboxRoot = realpathSync(mkdtempSync(join(tmpdir(), "kota-socket-root-")));
const socketPath = join(workingDir, "host.sock");
const server = createServer((socket) => socket.destroy());
let finished = false;
const deadline = setTimeout(
  () => finish(5, "KOTA_PATHNAME_UNIX_SOCKET_PROBE_TIMEOUT"),
  1500,
);

function cleanupAndExit(status, evidence) {
  for (const path of [sandboxRoot, workingDir]) {
    rmSync(path, { recursive: true, force: true });
  }
  console.log(evidence);
  process.exit(status);
}

function finish(status, evidence) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  if (server.listening) {
    server.close(() => cleanupAndExit(status, evidence));
  } else {
    cleanupAndExit(status, evidence);
  }
}

server.once("error", (error) => {
  finish(6, \`KOTA_PATHNAME_UNIX_SOCKET_SERVER_ERROR:\${error.message}\`);
});
server.listen(socketPath, () => {
  const isolatedArgs = [
    ...prefixArgs,
    "/bin/sh",
    "-ceu",
    boundaryScript,
    "kota-analyzer-boundary",
    sandboxRoot,
    workingDir,
    process.execPath,
    String(runtimeFiles.length),
    "0",
    "0",
    ...runtimeFiles,
    "-e",
    attack,
    socketPath,
  ];
  const result = spawnSync(command, isolatedArgs, {
    encoding: "utf8",
    env: { LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 1000,
  });
  const socketDenied =
    result.status === 0 &&
    result.stdout.includes(${JSON.stringify(PATHNAME_UNIX_SOCKET_DENIED)});
  const diagnostics = [result.stdout, result.stderr, result.error?.message]
    .filter(Boolean)
    .join("\\n")
    .trim();
  finish(
    socketDenied ? 0 : 2,
    socketDenied
      ? ${JSON.stringify(PATHNAME_UNIX_SOCKET_ISOLATED)}
      : \`KOTA_PATHNAME_UNIX_SOCKET_BOUNDARY_FAILED:\${diagnostics}\`,
  );
});
`;

export type ScientificClaimPathnameUnixSocketProbe =
  | { denied: true }
  | { denied: false; issue: string };

export function probeScientificClaimPathnameUnixSocketIsolation(
  boundary: {
    command: string;
    prefixArgs: readonly string[];
    runtimeFiles: readonly string[];
  },
): ScientificClaimPathnameUnixSocketProbe {
  const result = runScientificClaimCapabilityProbe(process.execPath, [
    "-e",
    PATHNAME_UNIX_SOCKET_PROBE_CONTROLLER,
    boundary.command,
    JSON.stringify(boundary.prefixArgs),
    LINUX_ANALYZER_FILESYSTEM_BOUNDARY,
    PATHNAME_UNIX_SOCKET_ATTACK,
    JSON.stringify(boundary.runtimeFiles),
  ]);
  return scientificClaimCapabilityProbePassed(
    result,
    PATHNAME_UNIX_SOCKET_ISOLATED,
  )
    ? { denied: true }
    : {
        denied: false,
        issue: describeScientificClaimCapabilityProbeFailure(
          "pathname Unix-socket capability probe",
          result,
        ),
      };
}
