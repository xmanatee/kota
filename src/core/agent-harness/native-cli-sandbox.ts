import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { existingProtectedProjectPaths } from "#core/tools/protected-project-paths.js";
import { buildMachineAuthoritySandboxLaunch } from "./machine-authority-sandbox.js";
import {
  type NativeCliEgressProxy,
  startNativeCliEgressProxy,
} from "./native-cli-egress-proxy.js";
import { buildIsolatedNativeCliEnvironment } from "./native-cli-environment.js";
import { prepareNativeCliPackageManagerRuntime } from "./native-cli-package-manager.js";
import {
  nativeCliReadableRoots,
  resolveNativeCliExecutable,
} from "./native-cli-sandbox-roots.js";

export type NativeCliSandboxProcess = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

export type NativeCliMachineAuthorityOwner = "kota" | "native-cli";

type NativeCliSandboxOptions = {
  cwd: string;
  machineAuthorityOwner: NativeCliMachineAuthorityOwner;
  authorityConfigPath?: string;
  writableRoots: readonly string[];
  env: NodeJS.ProcessEnv;
  readOnlyHostRoots?: readonly string[];
  allowedEgressHosts?: readonly string[];
  prepareEnvironment?: (
    context: NativeCliRuntimeContext,
    env: NodeJS.ProcessEnv,
  ) => NodeJS.ProcessEnv;
};

export type NativeCliRuntimeContext = {
  invocationRoot: string;
  toolRuntimeRoot: string;
  readableRoots: readonly string[];
  writableRoots: readonly string[];
  readProtectedPaths: readonly string[];
  writeProtectedPaths: readonly string[];
};

const NATIVE_CLI_LINUX_PROXY_PORT = 43_217;

const NATIVE_CLI_LINUX_PROXY_BRIDGE = `
const { spawn } = require("node:child_process");
const { createConnection, createServer } = require("node:net");
const [socketPath, portText, executable, ...args] = process.argv.slice(1);
const server = createServer((client) => {
  const upstream = createConnection(socketPath);
  client.once("error", () => upstream.destroy());
  upstream.once("error", () => client.destroy());
  client.pipe(upstream).pipe(client);
});
server.once("error", (error) => { console.error(error); process.exit(126); });
server.listen(Number(portText), "127.0.0.1", () => {
  const child = spawn(executable, args, { env: process.env, stdio: "inherit" });
  child.once("error", (error) => { console.error(error); process.exit(127); });
  child.once("close", (code, signal) => {
    server.close(() => {
      if (signal) process.kill(process.pid, signal);
      else process.exit(code ?? 1);
    });
  });
});
`;

function nativeCliLinuxProxyBridge(
  socketPath: string,
  executable: string,
  args: readonly string[],
): { args: string[]; port: number } {
  return {
    args: [
      "-e",
      NATIVE_CLI_LINUX_PROXY_BRIDGE,
      socketPath,
      String(NATIVE_CLI_LINUX_PROXY_PORT),
      executable,
      ...args,
    ],
    port: NATIVE_CLI_LINUX_PROXY_PORT,
  };
}

function withNativeCliEgressEnvironment(
  env: NodeJS.ProcessEnv,
  proxy: NativeCliEgressProxy,
  linuxBridgePort: number | undefined,
): NodeJS.ProcessEnv {
  const port = proxy.address.kind === "tcp"
    ? proxy.address.port
    : linuxBridgePort;
  if (port === undefined) {
    throw new Error("native CLI Linux provider egress bridge port is missing");
  }
  const proxyUrl = `http://127.0.0.1:${port}`;
  return {
    ...env,
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    WSS_PROXY: proxyUrl,
    GRPC_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    all_proxy: proxyUrl,
    wss_proxy: proxyUrl,
    grpc_proxy: proxyUrl,
    NO_PROXY: "",
    no_proxy: "",
    NODE_USE_ENV_PROXY: "1",
  };
}

function pathIsWithin(root: string, candidate: string): boolean {
  const child = relative(resolve(root), resolve(candidate));
  return child === "" || (
    child !== ".." &&
    !child.startsWith(`..${sep}`) &&
    !isAbsolute(child)
  );
}

function absoluteRoots(paths: readonly string[], cwd: string): string[] {
  return [...new Set(paths.map((path) => resolve(cwd, path)))];
}

export async function withNativeCliSandbox<T>(
  executable: string,
  args: readonly string[],
  options: NativeCliSandboxOptions,
  run: (process: NativeCliSandboxProcess) => Promise<T>,
): Promise<T> {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "kota-native-cli-"));
  let egressProxy: NativeCliEgressProxy | undefined;
  try {
    const toolRuntimeRoot = join(temporaryDirectory, "tool-runtime");
    const home = join(toolRuntimeRoot, "home");
    for (const directory of [
      home,
      join(home, ".config"),
      join(home, ".cache"),
      join(home, ".local", "share"),
      join(home, ".local", "state"),
      join(toolRuntimeRoot, "runtime"),
    ]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    const packageManager = prepareNativeCliPackageManagerRuntime(
      options.cwd,
      temporaryDirectory,
      options.env,
    );
    const executablePath = resolveNativeCliExecutable(
      executable,
      packageManager.env,
    );
    const allowedEgressHosts = options.allowedEgressHosts ?? [];
    if (allowedEgressHosts.length > 0) {
      egressProxy = await startNativeCliEgressProxy(
        allowedEgressHosts,
        process.platform === "linux"
          ? join(temporaryDirectory, "provider-egress.sock")
          : undefined,
      );
    }
    const linuxBridge = egressProxy?.address.kind === "unix"
      ? nativeCliLinuxProxyBridge(egressProxy.address.path, executablePath, args)
      : undefined;
    const launchExecutable = linuxBridge === undefined
      ? executablePath
      : process.execPath;
    const launchArgs = linuxBridge === undefined ? args : linuxBridge.args;
    const readableRoots = [
      ...nativeCliReadableRoots(
        executablePath,
        options.cwd,
        temporaryDirectory,
        packageManager.env,
      ),
      ...(linuxBridge === undefined
        ? []
        : nativeCliReadableRoots(
            process.execPath,
            options.cwd,
            temporaryDirectory,
            packageManager.env,
          )),
      ...(options.readOnlyHostRoots ?? []),
      ...packageManager.readOnlyHostRoots,
    ];
    const readProtectedPaths = [...new Set([
      ...existingProtectedProjectPaths(options.cwd),
      ...(resolve(options.cwd) === resolve(process.cwd())
        ? []
        : existingProtectedProjectPaths(process.cwd())),
    ])];
    const writeProtectedPaths = [join(options.cwd, ".git")];
    const launch = options.machineAuthorityOwner === "native-cli"
      ? {
          ok: true as const,
          command: launchExecutable,
          args: [...launchArgs],
        }
      : buildMachineAuthoritySandboxLaunch(launchExecutable, launchArgs, {
          cwd: options.cwd,
          authorityConfigPath: options.authorityConfigPath,
          readableRoots,
          writableRoots: [...options.writableRoots, temporaryDirectory],
          readProtectedPaths,
          writeProtectedPaths,
          networkAccess: egressProxy?.address.kind === "tcp"
            ? { kind: "loopback-proxy", port: egressProxy.address.port }
            : { kind: "offline" },
        });
    if (!launch.ok) throw new Error(launch.error);
    const preparedEnvironment = options.prepareEnvironment?.(
      {
        invocationRoot: temporaryDirectory,
        toolRuntimeRoot,
        readableRoots: absoluteRoots(
          readableRoots.filter(
            (path) => !pathIsWithin(temporaryDirectory, path),
          ),
          options.cwd,
        ),
        writableRoots: absoluteRoots(options.writableRoots, options.cwd),
        readProtectedPaths,
        writeProtectedPaths,
      },
      packageManager.env,
    ) ?? packageManager.env;
    const isolatedEnvironment = buildIsolatedNativeCliEnvironment(
      preparedEnvironment,
      toolRuntimeRoot,
    );
    const env = egressProxy === undefined
      ? isolatedEnvironment
      : withNativeCliEgressEnvironment(
          isolatedEnvironment,
          egressProxy,
          linuxBridge?.port,
        );
    return await run({
      command: launch.command,
      args: launch.args,
      env,
    });
  } finally {
    await egressProxy?.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

const SANDBOX_BOOTSTRAP_ERROR = "sandbox-exec: sandbox_apply: Operation not permitted";

export function isNativeCliSandboxBootstrapError(text: string): boolean {
  return text.includes(SANDBOX_BOOTSTRAP_ERROR);
}
