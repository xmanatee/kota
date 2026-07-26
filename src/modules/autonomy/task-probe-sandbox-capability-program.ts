export const SANDBOX_CAPABILITY_EVIDENCE =
  "KOTA_RUNTIME_PROBE_BOUNDARY_CONTAINED";
export const SANDBOX_POST_EXEC_ABORT_EVIDENCE =
  "KOTA_RUNTIME_PROBE_POST_EXEC_ABORT_CONTAINED";

export const SANDBOX_CAPABILITY_PROGRAM = `
const { spawn, spawnSync } = require("node:child_process");
const { accessSync, constants, existsSync, linkSync, readFileSync, writeFileSync } = require("node:fs");
const { networkInterfaces } = require("node:os");
const net = require("node:net");
const [insidePath, outsidePath, outsideLink, outsideHardLink, relinkedAlias, detachedReady, hostPidRaw, pnpmPath] = process.argv.slice(1);
try {
  writeFileSync(insidePath, "inside");
} catch (error) {
  console.error("KOTA_RUNTIME_PROBE_INSIDE_WRITE_FAILED", error);
  process.exit(2);
}
try {
  const detachedProgram = 'const fs = require("node:fs"); fs.writeFileSync(' + JSON.stringify(detachedReady) + ', "ready"); const initialParent = process.ppid; const timer = setInterval(() => { if (process.ppid !== initialParent) { clearInterval(timer); fs.writeSync(3, "KOTA_RUNTIME_PROBE_DETACHED_DESCENDANT_SURVIVED"); process.exit(0); } }, 10); setTimeout(() => process.exit(0), 2000)';
  const detached = spawn(process.execPath, ["-e", detachedProgram], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore", 3],
  });
  detached.unref();
  const detachedReadyDeadline = Date.now() + 500;
  while (!existsSync(detachedReady) && Date.now() < detachedReadyDeadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
  if (!existsSync(detachedReady)) {
    console.error("KOTA_RUNTIME_PROBE_DETACHED_PROCESS_DID_NOT_START");
    process.exit(26);
  }
} catch (error) {
  console.error("KOTA_RUNTIME_PROBE_DETACHED_PROCESS_CHECK_FAILED", error);
  process.exit(25);
}
try {
  readFileSync(outsideLink);
  console.error("KOTA_RUNTIME_PROBE_SYMLINK_READ_SUCCEEDED");
  process.exit(17);
} catch (error) {
  if (!["EACCES", "ENOENT", "EPERM"].includes(error?.code)) {
    console.error("KOTA_RUNTIME_PROBE_SYMLINK_READ_CHECK_FAILED", error);
    process.exit(18);
  }
}
try {
  readFileSync(outsidePath);
  console.error("KOTA_RUNTIME_PROBE_OUTSIDE_READ_SUCCEEDED");
  process.exit(10);
} catch (error) {
  if (!["EACCES", "ENOENT", "EPERM"].includes(error?.code)) {
    console.error("KOTA_RUNTIME_PROBE_OUTSIDE_READ_CHECK_FAILED", error);
    process.exit(11);
  }
}
for (const hostIpcPath of [
  "/run/dbus/system_bus_socket",
  "/run/systemd/private",
  "/var/run/docker.sock",
  "/var/run/dbus/system_bus_socket",
  "/dev/log",
  "/tmp/.X11-unix",
]) {
  try {
    accessSync(hostIpcPath, constants.F_OK);
    console.error("KOTA_RUNTIME_PROBE_HOST_IPC_VISIBLE", hostIpcPath);
    process.exit(12);
  } catch (error) {
    if (!["EACCES", "ENOENT", "EPERM"].includes(error?.code)) {
      console.error("KOTA_RUNTIME_PROBE_HOST_IPC_CHECK_FAILED", hostIpcPath, error);
      process.exit(13);
    }
  }
}
try {
  accessSync(pnpmPath, constants.R_OK | constants.X_OK);
} catch (error) {
  console.error("KOTA_RUNTIME_PROBE_PNPM_RUNTIME_UNAVAILABLE", error);
  process.exit(14);
}
const abortAttempt = spawnSync(
  process.execPath,
  ["-e", "process.abort()"],
  { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] },
);
if (abortAttempt.status !== null || abortAttempt.signal !== "SIGABRT") {
  console.error(
    "KOTA_RUNTIME_PROBE_POST_EXEC_ABORT_CHECK_FAILED",
    abortAttempt.status,
    abortAttempt.signal,
    abortAttempt.error,
  );
  process.exit(27);
}
console.log(${JSON.stringify(SANDBOX_POST_EXEC_ABORT_EVIDENCE)});
try {
  writeFileSync(outsidePath, "escaped");
  console.error("KOTA_RUNTIME_PROBE_OUTSIDE_WRITE_SUCCEEDED");
  process.exit(3);
} catch (error) {
  if (!["EACCES", "ENOENT", "EPERM", "EROFS"].includes(error?.code)) {
    console.error("KOTA_RUNTIME_PROBE_OUTSIDE_WRITE_CHECK_FAILED", error);
    process.exit(9);
  }
}
try {
  writeFileSync(outsideLink, "escaped-through-link");
  console.error("KOTA_RUNTIME_PROBE_SYMLINK_WRITE_SUCCEEDED");
  process.exit(19);
} catch (error) {
  if (!["EACCES", "ENOENT", "EPERM", "EROFS"].includes(error?.code)) {
    console.error("KOTA_RUNTIME_PROBE_SYMLINK_WRITE_CHECK_FAILED", error);
    process.exit(20);
  }
}
try {
  writeFileSync(outsideHardLink, "escaped-through-hard-link");
  console.error("KOTA_RUNTIME_PROBE_HARD_LINK_WRITE_SUCCEEDED");
  process.exit(21);
} catch (error) {
  if (!["EACCES", "ENOENT", "EPERM", "EROFS"].includes(error?.code)) {
    console.error("KOTA_RUNTIME_PROBE_HARD_LINK_WRITE_CHECK_FAILED", error);
    process.exit(22);
  }
}
try {
  linkSync(outsideHardLink, relinkedAlias);
  console.error("KOTA_RUNTIME_PROBE_HARD_LINK_RELINK_SUCCEEDED");
  process.exit(23);
} catch (error) {
  if (!["EACCES", "ENOENT", "EPERM", "EROFS", "EXDEV"].includes(error?.code)) {
    console.error("KOTA_RUNTIME_PROBE_HARD_LINK_RELINK_CHECK_FAILED", error);
    process.exit(24);
  }
}

const hostPid = Number(hostPidRaw);
try {
  process.kill(hostPid, 0);
  console.error("KOTA_RUNTIME_PROBE_HOST_SIGNAL_VISIBLE");
  process.exit(4);
} catch (error) {
  if (error?.code !== "EPERM" && error?.code !== "ESRCH") {
    console.error("KOTA_RUNTIME_PROBE_HOST_SIGNAL_CHECK_FAILED", error);
    process.exit(5);
  }
}

const externalInterfaces = Object.values(networkInterfaces()).flat().filter((address) => address && !address.internal);
const socket = net.connect({ host: "127.0.0.1", port: 1 });
const timer = setTimeout(() => {
  socket.destroy();
  console.error("KOTA_RUNTIME_PROBE_NETWORK_CHECK_TIMEOUT");
  process.exit(6);
}, 500);
socket.once("connect", () => {
  clearTimeout(timer);
  socket.destroy();
  console.error("KOTA_RUNTIME_PROBE_NETWORK_CONNECTED");
  process.exit(7);
});
socket.once("error", (error) => {
  clearTimeout(timer);
  const denied = error?.code === "EACCES" || error?.code === "EPERM";
  const namespaceIsolated = externalInterfaces.length === 0 &&
    ["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"].includes(error?.code);
  if (!denied && !namespaceIsolated) {
    console.error("KOTA_RUNTIME_PROBE_NETWORK_BOUNDARY_FAILED", error);
    process.exit(8);
  }
  console.log(${JSON.stringify(SANDBOX_CAPABILITY_EVIDENCE)});
});
`;
