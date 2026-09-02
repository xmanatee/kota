import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runEvalSet } from "./eval-set.js";
import {
  EXECUTION_PROFILE,
  PROFILE,
  seedFixture,
} from "./eval-set-test-support.js";
import { loadAllFixtures } from "./fixture.js";

describe("runEvalSet harness evidence", () => {
  let fixturesRoot: string;
  let runsRoot: string;

  beforeEach(() => {
    fixturesRoot = mkdtempSync(join(tmpdir(), "kota-eval-harness-set-fx-"));
    runsRoot = mkdtempSync(join(tmpdir(), "kota-eval-harness-set-runs-"));
  });

  afterEach(() => {
    rmSync(fixturesRoot, { recursive: true, force: true });
    rmSync(runsRoot, { recursive: true, force: true });
  });

  it("summarizes resolved harness and model evidence from child workflow artifacts", async () => {
    seedFixture(fixturesRoot, "alpha", { kind: "file-exists", path: "alpha.txt" });
    const report = await runEvalSet({
      workspaceRoot: fixturesRoot,
      fixtures: loadAllFixtures(fixturesRoot),
      executor: {
        preflight: () => EXECUTION_PROFILE,
        execute: async ({ workingDir }) => {
          writeFileSync(join(workingDir, "alpha.txt"), "ok");
          const childRunDir = join(workingDir, ".kota", "runs", "child-run");
          mkdirSync(childRunDir, { recursive: true });
          writeFileSync(
            join(childRunDir, "metadata.json"),
            JSON.stringify({
              metadataVersion: 1,
              id: "child-run",
              workflow: "noop",
              definitionPath: "workflows/noop.ts",
              trigger: { event: "eval.fixture", schemaRef: null, payload: {} },
              startedAt: "2026-04-24T00:00:00.000Z",
              completedAt: "2026-04-24T00:00:01.000Z",
              status: "success",
              runDir: childRunDir,
              steps: [
                {
                  id: "build",
                  type: "agent",
                  status: "success",
                  startedAt: "2026-04-24T00:00:00.000Z",
                  completedAt: "2026-04-24T00:00:01.000Z",
                  durationMs: 1_000,
                  usage: {
                    tokens: { state: "complete", inputTokens: 1, outputTokens: 1 },
                    cost: { state: "unknown" },
                  },
                  harness: "codex",
                  model: "gpt-5.6-sol",
                },
              ],
            }),
          );
          return {
            kind: "completed",
            durationMs: 10,
            runArtifactPath: childRunDir,
          };
        },
      },
      requestedProfile: PROFILE,
      runArtifactBaseDir: runsRoot,
      repeatCount: 1,
    });

    expect(
      report.runConfiguration.components.resolvedHarnessModelEvidence,
    ).toMatchObject({
      status: "complete",
      distinctHarnessModels: [{ harness: "codex", model: "gpt-5.6-sol", count: 1 }],
    });
    expect(report.runConfiguration.summary.resolvedHarnessModelEvidence).toBe(
      "codex/gpt-5.6-sol x1",
    );
  });

  it("ignores skipped agent steps when summarizing resolved harness and model evidence", async () => {
    seedFixture(fixturesRoot, "alpha", { kind: "file-exists", path: "alpha.txt" });
    const report = await runEvalSet({
      workspaceRoot: fixturesRoot,
      fixtures: loadAllFixtures(fixturesRoot),
      executor: {
        preflight: () => EXECUTION_PROFILE,
        execute: async ({ workingDir }) => {
          writeFileSync(join(workingDir, "alpha.txt"), "ok");
          const childRunDir = join(workingDir, ".kota", "runs", "child-run");
          mkdirSync(childRunDir, { recursive: true });
          writeFileSync(
            join(childRunDir, "metadata.json"),
            JSON.stringify({
              metadataVersion: 1,
              id: "child-run",
              workflow: "decomposer",
              definitionPath: "workflows/decomposer.ts",
              trigger: { event: "eval.fixture", schemaRef: null, payload: {} },
              startedAt: "2026-04-24T00:00:00.000Z",
              completedAt: "2026-04-24T00:00:01.000Z",
              status: "success",
              runDir: childRunDir,
              steps: [
                {
                  id: "assess-failure",
                  type: "code",
                  status: "success",
                  startedAt: "2026-04-24T00:00:00.000Z",
                  completedAt: "2026-04-24T00:00:00.500Z",
                  durationMs: 500,
                },
                {
                  id: "decompose",
                  type: "agent",
                  status: "skipped",
                  startedAt: "2026-04-24T00:00:00.500Z",
                  completedAt: "2026-04-24T00:00:01.000Z",
                  durationMs: 500,
                  skipReason: { kind: "when-predicate" },
                },
              ],
            }),
          );
          return {
            kind: "completed",
            durationMs: 10,
            runArtifactPath: childRunDir,
          };
        },
      },
      requestedProfile: PROFILE,
      runArtifactBaseDir: runsRoot,
      repeatCount: 1,
    });

    expect(
      report.runConfiguration.components.resolvedHarnessModelEvidence,
    ).toMatchObject({
      status: "empty",
      observations: [],
      missingArtifacts: [],
      distinctHarnessModels: [],
    });
    expect(report.runConfiguration.summary.resolvedHarnessModelEvidence).toBe(
      "no agent-step evidence",
    );
  });
});
