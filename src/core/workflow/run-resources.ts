import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import type { RunSandbox } from "./run-sandbox.js";
import type { RunStateDatabase } from "./run-state-database.js";
import type { StoredRun } from "./run-state-types.js";

export type RunPortRange = Readonly<{
  start: number;
  end: number;
  size: number;
  values: readonly number[];
}>;

export type RunResourceProfile = Readonly<{
  runId: string;
  attempt: number;
  daemonEpoch: number;
  workspaceDir: string;
  runDir: string;
  tempDir: string;
  artifactDir: string;
  agentDir: string;
  packageCacheDir: string;
  ports: RunPortRange;
  env: Readonly<Record<string, string>>;
}>;

export type RunResourceAllocatorOptions = Readonly<{
  portStart: number;
  portEnd: number;
  portRangeSize: number;
  isPortAvailable?: (port: number) => Promise<boolean>;
  now?: () => string;
}>;

function assertPortConfiguration(options: RunResourceAllocatorOptions): void {
  const values = [options.portStart, options.portEnd, options.portRangeSize];
  if (values.some((value) => !Number.isInteger(value))) {
    throw new Error("Run resource port configuration must contain integers");
  }
  if (
    options.portStart < 1 ||
    options.portEnd > 65_535 ||
    options.portEnd < options.portStart ||
    options.portRangeSize < 1 ||
    options.portRangeSize > options.portEnd - options.portStart + 1
  ) {
    throw new Error("Invalid run resource port configuration");
  }
}

function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

function immutableProfile(input: {
  run: StoredRun;
  sandbox: RunSandbox;
  daemonEpoch: number;
  agentDir: string;
  packageCacheDir: string;
  ports: number[];
}): RunResourceProfile {
  const { run, sandbox, daemonEpoch, agentDir, packageCacheDir, ports } = input;
  const start = ports[0]!;
  const end = ports.at(-1)!;
  const frozenPorts = Object.freeze([...ports]);
  const env = Object.freeze({
    TMPDIR: sandbox.tempDir,
    TMP: sandbox.tempDir,
    TEMP: sandbox.tempDir,
    KOTA_WORKSPACE_DIR: sandbox.workspaceDir,
    KOTA_RUN_DIR: agentDir,
    KOTA_RUN_TEMP_DIR: sandbox.tempDir,
    KOTA_RUN_ARTIFACT_DIR: sandbox.artifactDir,
    KOTA_PACKAGE_CACHE_DIR: packageCacheDir,
    KOTA_PORT_BASE: String(start),
    KOTA_PORT_RANGE: String(frozenPorts.length),
    npm_config_cache: join(packageCacheDir, "npm"),
    npm_config_store_dir: join(packageCacheDir, "pnpm-store"),
    YARN_CACHE_FOLDER: join(packageCacheDir, "yarn"),
  });
  return Object.freeze({
    runId: run.id,
    attempt: run.attempt,
    daemonEpoch,
    workspaceDir: sandbox.workspaceDir,
    runDir: sandbox.rootDir,
    tempDir: sandbox.tempDir,
    artifactDir: sandbox.artifactDir,
    agentDir,
    packageCacheDir,
    ports: Object.freeze({
      start,
      end,
      size: frozenPorts.length,
      values: frozenPorts,
    }),
    env,
  });
}

/** Allocates resources shared by every workflow attempt. */
export class RunResourceAllocator {
  private readonly isPortAvailable: (port: number) => Promise<boolean>;
  private readonly now: () => string;

  constructor(
    private readonly state: RunStateDatabase,
    private readonly options: RunResourceAllocatorOptions,
  ) {
    assertPortConfiguration(options);
    this.isPortAvailable = options.isPortAvailable ?? portAvailable;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async allocate(
    run: StoredRun,
    sandbox: RunSandbox,
    daemonEpoch: number,
  ): Promise<RunResourceProfile> {
    if (run.id !== sandbox.runId || run.repository !== sandbox.repository) {
      throw new Error(`Sandbox does not belong to run "${run.id}"`);
    }
    if (run.state !== "running" && run.state !== "integrating") {
      throw new Error(`Run "${run.id}" is not active`);
    }
    if (run.attempt < 1) throw new Error(`Run "${run.id}" has no active attempt`);

    const agentDir = join(sandbox.rootDir, "agent");
    const packageCacheDir = join(sandbox.tempDir, "package-cache");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(packageCacheDir, { recursive: true });

    const { portStart, portEnd, portRangeSize } = this.options;
    for (
      let start = portStart;
      start + portRangeSize - 1 <= portEnd;
      start += portRangeSize
    ) {
      const claimed: number[] = [];
      let complete = true;
      try {
        for (let port = start; port < start + portRangeSize; port += 1) {
          if (!(await this.isPortAvailable(port))) {
            complete = false;
            break;
          }
          if (
            !this.state.tryAcquireResource({
              runId: run.id,
              resourceKey: `global:port:${port}`,
              lifetime: "attempt",
              epoch: daemonEpoch,
              acquiredAt: this.now(),
            })
          ) {
            complete = false;
            break;
          }
          claimed.push(port);
        }
        if (complete) {
          return immutableProfile({
            run,
            sandbox,
            daemonEpoch,
            agentDir,
            packageCacheDir,
            ports: claimed,
          });
        }
      } catch (error) {
        for (const port of claimed) {
          this.state.releaseResource(run.id, `global:port:${port}`, daemonEpoch);
        }
        throw error;
      }
      for (const port of claimed) {
        this.state.releaseResource(run.id, `global:port:${port}`, daemonEpoch);
      }
    }
    throw new Error("No run-owned local port range is available");
  }
}
