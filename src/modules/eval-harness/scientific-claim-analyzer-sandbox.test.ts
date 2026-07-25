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

describe("scientific claim analyzer process sandbox", () => {
  it("does not start the analyzer when isolation is unavailable", () => {
    const workingDir = mkdtempSync(join(tmpdir(), "kota-network-fail-closed-"));
    const marker = join(workingDir, "analyzer-ran");
    try {
      const execution = spawnScientificClaimAnalyzer(
        {
          kind: "unavailable",
          evidence: "test boundary unavailable",
          issue: "network isolation unavailable",
        },
        [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`,
        ],
        {
          cwd: workingDir,
          env: { LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
          maxBuffer: 64 * 1024,
          timeout: 1_000,
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
