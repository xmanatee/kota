import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFixture } from "./fixture.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import {
  cleanupFixtureWorkingDir,
  runFixture,
  type WorkflowExecutionOutcome,
  type WorkflowExecutor,
} from "./runner.js";

const FIXTURE_ID = "builder-black-box-behavior-reconstruction";
const FIXTURES_ROOT = join(process.cwd(), "src/modules/eval-harness/fixtures");

const TEST_PROFILE: ResourceProfile = {
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4000,
  memoryKillThresholdMB: 4000,
  hostClass: "test",
};

const TEST_EXECUTION_PROFILE: ExecutionProfilePreflightResult = {
  status: "verified",
  backendKind: "container",
  requestedProfile: TEST_PROFILE,
  observedOrEnforcedProfile: TEST_PROFILE,
  verification: "enforced",
  gateEligible: true,
  eligibilityReason: "verified-profile",
  diagnostics: [],
};

function embeddedOracleCandidate(base64: string): string {
  return `#!/usr/bin/env node
const payload = ${JSON.stringify(base64)};
const bytes = Buffer.from(payload, "base64");
const { instance } = await WebAssembly.instantiate(bytes);
const { mix, finish } = instance.exports;
const families = ["amber", "cobalt", "fern", "slate", "violet"];
const help = \`badge-code

Usage:
  node src/badge-code.mjs <label>

Prints: <normalized-label> <family>-<checksum>
\`;

function fail(message) {
  console.error(\`error: \${message}\`);
  process.exit(2);
}

function normalize(raw) {
  if (/[^A-Za-z0-9 _-]/.test(raw)) {
    fail("label contains unsupported characters");
  }
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[ _-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/[a-z0-9]/.test(normalized)) {
    fail("label must contain at least one alphanumeric character");
  }
  if (normalized.length > 24) {
    fail("normalized label exceeds 24 characters");
  }
  return normalized;
}

function checksumFor(normalized) {
  let state = 23;
  for (let index = 0; index < normalized.length; index += 1) {
    state = mix(state, normalized.charCodeAt(index), index);
  }
  return finish(state, normalized.length);
}

const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  console.log(help.trimEnd());
  process.exit(0);
}
if (args.length !== 1) {
  fail("expected exactly one label argument");
}
const normalized = normalize(args[0]);
const checksum = checksumFor(normalized);
const family = families[checksum % families.length];
const code = checksum.toString(36).toUpperCase().padStart(2, "0");
console.log(\`\${normalized} \${family}-\${code}\`);
`;
}

describe("builder black-box behavior reconstruction fixture", () => {
  it("runs as a live-builder fixture without replay recordings", async () => {
    const fixture = loadFixture(FIXTURES_ROOT, FIXTURE_ID);
    expect(fixture.agentStepRecordings).toHaveLength(0);

    let replayRecordingsRoot: string | undefined;
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async (request): Promise<WorkflowExecutionOutcome> => {
        replayRecordingsRoot = request.replayRecordingsRoot;
        return { kind: "completed", durationMs: 5, runArtifactPath: null };
      },
    };
    const runArtifactBaseDir = mkdtempSync(
      join(tmpdir(), "kota-black-box-live-fixture-"),
    );
    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir,
      runIndex: 0,
      repeatCount: 1,
    });
    try {
      expect(replayRecordingsRoot).toBeUndefined();
    } finally {
      cleanupFixtureWorkingDir(report.workingDir);
      rmSync(runArtifactBaseDir, { recursive: true, force: true });
    }
  });

  it("rejects a behaviorally correct candidate that embeds the oracle artifact", () => {
    const fixture = loadFixture(FIXTURES_ROOT, FIXTURE_ID);
    const workingDir = mkdtempSync(join(tmpdir(), "kota-black-box-shortcut-"));
    try {
      cpSync(fixture.initialStateDir, workingDir, { recursive: true });
      const oracleBase64 = readFileSync(
        join(workingDir, "oracle/reference.wasm.base64"),
        "utf8",
      ).trim();
      writeFileSync(
        join(workingDir, "src/badge-code.mjs"),
        embeddedOracleCandidate(oracleBase64),
      );

      const result = spawnSync(
        process.execPath,
        ["scripts/score.mjs", "--max-mismatches", "0"],
        { cwd: workingDir, encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.behavior_mismatches).toBeGreaterThan(0);
      expect(report.mismatches).toHaveLength(0);
      expect(report.shortcut_guard.join("\n")).toContain(
        "embeds the oracle artifact",
      );
      expect(report.shortcut_guard.join("\n")).toContain("WebAssembly");
    } finally {
      rmSync(workingDir, { recursive: true, force: true });
    }
  });
});
