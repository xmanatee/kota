import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSingleWorkflowFixtureSpec, loadFixture } from "./fixture.js";
import { evaluatePredicate } from "./predicates.js";
import {
  resolveScientificClaimAnalyzerSandbox,
  spawnScientificClaimAnalyzer,
} from "./scientific-claim-analyzer-sandbox.js";
import {
  LINUX_ANALYZER_FILESYSTEM_BOUNDARY,
  linuxAnalyzerBoundaryArgs,
  linuxAnalyzerInvocationArgs,
} from "./scientific-claim-linux-filesystem-boundary.js";
import { probeScientificClaimPathnameUnixSocketIsolation } from "./scientific-claim-pathname-socket-capability.js";
import { probeScientificClaimHostSignalIsolation } from "./scientific-claim-sandbox-capabilities.js";

const FIXTURE_ID = "builder-scientific-claim-reproduction";
const FIXTURES_ROOT = join(process.cwd(), "src/modules/eval-harness/fixtures");
const CALIBRATION_ROOT = join(FIXTURES_ROOT, FIXTURE_ID, "calibration");
const passingAnalyzer = readFileSync(
  join(CALIBRATION_ROOT, "analyze-claim.mjs"),
  "utf8",
);

function seedVisibleArtifacts(workingDir: string): void {
  for (const [dataPath, outputPath] of [
    ["data/claims/lx12-biomass.csv", "claim-result.json"],
    ["data/claims/lx12-holdout.csv", "claim-holdout-result.json"],
  ] as const) {
    const result = spawnSync(
      process.execPath,
      ["scripts/analyze-claim.mjs", "--data", dataPath, "--output", outputPath],
      { cwd: workingDir, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
  }
}

function writeSignalDenyBoundary(workingDir: string): string {
  const preloadPath = join(workingDir, "deny-process-kill.cjs");
  writeFileSync(
    preloadPath,
    `
process.kill = () => {
  const error = new Error("host process signaling denied");
  error.code = "EPERM";
  throw error;
};
`,
  );
  const boundaryPath = join(workingDir, "signal-deny-boundary.cjs");
  writeFileSync(
    boundaryPath,
    `
const { spawnSync } = require("node:child_process");
const [command, ...args] = process.argv.slice(2);
const result = spawnSync(
  command,
  ["--require", ${JSON.stringify(preloadPath)}, ...args],
  {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
`,
  );
  return boundaryPath;
}

function writeFilesystemBoundaryBypass(workingDir: string): string {
  const boundaryPath = join(workingDir, "filesystem-boundary-bypass.cjs");
  writeFileSync(
    boundaryPath,
    `
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const markerIndex = args.indexOf("kota-analyzer-boundary");
if (markerIndex === -1) process.exit(8);
const boundaryArgs = args.slice(markerIndex + 1);
const [
  ,
  isolatedWorkingDir,
  command,
  runtimeFileCount,
  readFileCount,
  writeFileCount,
] = boundaryArgs;
const commandArgs = boundaryArgs.slice(
  6 + Number(runtimeFileCount) + Number(readFileCount) + Number(writeFileCount),
);
const result = spawnSync(command, commandArgs, {
  cwd: isolatedWorkingDir,
  encoding: "utf8",
  env: process.env,
  maxBuffer: 64 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
`,
  );
  return boundaryPath;
}

describe("scientific claim analyzer process sandbox", () => {
  it("builds the Linux disposable root from exact files, never host runtime directories", () => {
    expect(LINUX_ANALYZER_FILESYSTEM_BOUNDARY).not.toMatch(
      /mount_runtime_dir|mount --bind "\$working_dir"|mount[^\n]*\/(?:usr|bin|lib|lib64)(?:\s|$)/,
    );
    expect(
      linuxAnalyzerBoundaryArgs({
        prefixArgs: ["--isolate", "--"],
        sandboxRoot: "/tmp/root",
        workingDir: "/tmp/work",
        nodePath: "/usr/bin/node",
        runtimeFiles: ["/usr/bin/node", "/lib/ld.so"],
        readOnlyPaths: ["/tmp/work/analyzer.mjs", "/tmp/work/input.csv"],
        writablePaths: ["/tmp/work/output.json"],
        nodeArgs: ["analyzer.mjs"],
      }).slice(-12),
    ).toEqual([
      "/tmp/root",
      "/tmp/work",
      "/usr/bin/node",
      "2",
      "2",
      "1",
      "/usr/bin/node",
      "/lib/ld.so",
      "/tmp/work/analyzer.mjs",
      "/tmp/work/input.csv",
      "/tmp/work/output.json",
      "analyzer.mjs",
    ]);
    expect(LINUX_ANALYZER_FILESYSTEM_BOUNDARY).not.toContain("--skip-chdir");
    expect(LINUX_ANALYZER_FILESYSTEM_BOUNDARY).toContain(
      'exec "$chroot_path" "$root" "$node_path" "$@"',
    );
    const invocationArgs = linuxAnalyzerInvocationArgs({
      workingDir: "/tmp/work",
      nodeOptions: ["--permission", "--allow-fs-read=/tmp/work/input.csv"],
      scriptPath: "analyzer.mjs",
      scriptArgs: ["--data", "input.csv"],
    });
    expect(invocationArgs).toMatchObject([
      "--permission",
      "--allow-fs-read=/tmp/work/input.csv",
      "-e",
      expect.stringContaining("process.chdir(workingDir)"),
      "/tmp/work",
      "analyzer.mjs",
      "--data",
      "input.csv",
    ]);
  });

  it("enters the private working directory while preserving relative analyzer arguments", () => {
    const workingDir = mkdtempSync(join(tmpdir(), "kota-analyzer-bootstrap-"));
    const analyzer = join(workingDir, "analyzer.mjs");
    try {
      writeFileSync(
        analyzer,
        `process.stdout.write(JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(1) }));`,
      );
      const result = spawnSync(
        process.execPath,
        linuxAnalyzerInvocationArgs({
          workingDir,
          nodeOptions: ["--permission", `--allow-fs-read=${workingDir}`],
          scriptPath: "analyzer.mjs",
          scriptArgs: ["--data", "input.csv"],
        }),
        { encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        cwd: workingDir,
        argv: ["analyzer.mjs", "--data", "input.csv"],
      });
    } finally {
      rmSync(workingDir, { recursive: true, force: true });
    }
  });

  it("does not start the analyzer when isolation is unavailable", () => {
    const workingDir = mkdtempSync(join(tmpdir(), "kota-network-fail-closed-"));
    const marker = join(workingDir, "analyzer-ran");
    const analyzer = join(workingDir, "analyzer.mjs");
    try {
      writeFileSync(
        analyzer,
        `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`,
      );
      const execution = spawnScientificClaimAnalyzer(
        {
          kind: "unavailable",
          evidence: "test boundary unavailable",
          issue: "network isolation unavailable",
        },
        { nodeOptions: [], scriptPath: analyzer, scriptArgs: [] },
        {
          cwd: workingDir,
          env: { LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
          maxBuffer: 64 * 1024,
          readOnlyPaths: [],
          timeout: 1_000,
          writablePaths: [],
        },
      );

      expect(execution).toEqual({
        started: false,
        issue: "network isolation unavailable",
      });
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(workingDir, { recursive: true, force: true });
    }
  });

  it("runs a process.kill attack and accepts only a boundary that keeps the host sentinel alive", () => {
    const workingDir = mkdtempSync(join(tmpdir(), "kota-signal-capability-"));
    try {
      const signalDenyBoundary = writeSignalDenyBoundary(workingDir);
      const capability = probeScientificClaimHostSignalIsolation(
        process.execPath,
        [signalDenyBoundary],
      );

      expect(capability).toEqual({ denied: true });
      expect(() => process.kill(process.pid, 0)).not.toThrow();
    } finally {
      rmSync(workingDir, { recursive: true, force: true });
    }
  });

  it("rejects a passthrough boundary that lets the analyzer terminate its disposable sentinel", () => {
    const capability = probeScientificClaimHostSignalIsolation(
      "/usr/bin/env",
      [],
    );

    expect(capability.denied).toBe(false);
    if (capability.denied) {
      throw new Error("passthrough boundary unexpectedly denied host signaling");
    }
    expect(capability.issue).toContain("KOTA_HOST_SIGNAL_DELIVERED");
    expect(() => process.kill(process.pid, 0)).not.toThrow();
  });

  it("rejects a Linux boundary that leaves a host pathname Unix socket visible", () => {
    const workingDir = mkdtempSync(join(tmpdir(), "kota-socket-capability-"));
    try {
      const boundaryBypass = writeFilesystemBoundaryBypass(workingDir);
      const capability = probeScientificClaimPathnameUnixSocketIsolation({
        command: process.execPath,
        prefixArgs: [boundaryBypass],
        runtimeFiles: [process.execPath],
      });

      expect(capability.denied).toBe(false);
      if (capability.denied) {
        throw new Error(
          "filesystem boundary bypass unexpectedly hid the host socket",
        );
      }
      expect(capability.issue).toMatch(
        /KOTA_PATHNAME_UNIX_SOCKET_CONNECTED|KOTA_PATHNAME_UNIX_SOCKET_SERVER_ERROR:.*(?:EACCES|EPERM)/,
      );
    } finally {
      rmSync(workingDir, { recursive: true, force: true });
    }
  });

  it("prevents the analyzer from sending verifier-only data to a loopback listener", async () => {
    const fixture = loadFixture(FIXTURES_ROOT, FIXTURE_ID);
    if (!isSingleWorkflowFixtureSpec(fixture.spec)) {
      throw new Error(`${FIXTURE_ID} must stay a single-workflow fixture`);
    }
    const claimPredicate = fixture.spec.predicates[0];
    const workingDir = mkdtempSync(join(tmpdir(), "kota-scientific-network-"));
    const received: string[] = [];
    const server = createServer((socket) => {
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => received.push(String(chunk)));
    });
    const listener = await new Promise<
      | { listening: true; port: number }
      | { listening: false; error: NodeJS.ErrnoException }
    >((resolve) => {
      server.once("error", (error: NodeJS.ErrnoException) => {
        resolve({ listening: false, error });
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          throw new Error("loopback listener did not expose a TCP port");
        }
        resolve({ listening: true, port: address.port });
      });
    });
    try {
      cpSync(fixture.initialStateDir, workingDir, { recursive: true });
      const port = listener.listening ? listener.port : 1;
      writeFileSync(
        join(workingDir, "scripts/analyze-claim.mjs"),
        `${passingAnalyzer}
if (dataPath.endsWith("lx12-verifier.csv")) {
  const { createConnection } = await import("node:net");
  const verifierData = readFileSync(dataPath, "utf8");
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: ${port} });
    socket.once("connect", () => {
      socket.end(verifierData);
      reject(new Error("verifier data reached the loopback listener"));
    });
    socket.once("error", (error) => {
      console.error(\`NETWORK_DENIED:\${error.code}\`);
      resolve();
    });
  });
}
`,
      );
      seedVisibleArtifacts(workingDir);

      const isolation = resolveScientificClaimAnalyzerSandbox();
      const result = evaluatePredicate(workingDir, claimPredicate);
      if (isolation.kind === "unavailable") {
        expect(result.passed).toBe(false);
        expect(result.detail).toContain("isolation");
      } else {
        expect(result.passed).toBe(true);
        expect(result.detail).toContain(isolation.evidence);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(received).toEqual([]);

      if (!listener.listening) {
        expect(["EACCES", "EPERM"]).toContain(listener.error.code);
      }
    } finally {
      if (listener.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
          });
        });
      }
      rmSync(workingDir, { recursive: true, force: true });
    }
  });
});
