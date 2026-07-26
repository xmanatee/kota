import {
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSkillAblationFixtureSpec, loadFixture } from "./fixture.js";
import {
  cleanupFixtureWorkingDir,
  runFixture,
  type WorkflowExecutor,
} from "./runner.js";
import {
  completeTicketNormalization,
  writeAgentStepArtifact,
} from "./runner-skill-execution-test-support.js";
import { writeSkillAblationFixture } from "./runner-skill-fixture-test-support.js";
import {
  setupFixtureTree,
  TEST_EXECUTION_PROFILE,
} from "./runner-test-profiles.js";
import { createFakeExecutableVerifierSandbox } from "./subprocess-executor-test-helpers.js";

const TEST_VERIFIER = createFakeExecutableVerifierSandbox();

afterAll(TEST_VERIFIER.cleanup);

describe("runFixture skill-ablation", () => {
  let fixturesRoot: string;
  let runsRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ fixturesRoot, runsRoot, cleanup } = setupFixtureTree());
  });

  afterEach(() => {
    cleanup();
  });

  it("runs skill-ablation variants and writes prompt-resolution evidence", async () => {
    writeSkillAblationFixture(fixturesRoot);
    const fixture = loadFixture(fixturesRoot, "skill-ablation-mini");
    const calls: string[] = [];
    const executor: WorkflowExecutor = {
      predicateContext: {
        executableVerifierSandbox: TEST_VERIFIER.sandbox,
      },
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async ({ workflowName, workingDir }) => {
        calls.push(workflowName);
        if (workflowName === "skill-ablation-focused-skill") {
          completeTicketNormalization({
            workingDir,
            valid: true,
            routing: "release",
          });
          return {
            kind: "completed",
            durationMs: 5,
            runArtifactPath: writeAgentStepArtifact({
              workingDir,
              workflowName,
              agentStepId: "solve-focused-skill",
              promptText: [
                "Solve the ticket.",
                "Ticket JSON Normalization Procedure",
                "Compute routing as release after validating required fields.",
              ].join("\n"),
              inputTokens: 1350,
              outputTokens: 130,
            }),
          };
        }
        if (workflowName === "skill-ablation-noisy-skill") {
          completeTicketNormalization({
            workingDir,
            valid: false,
            routing: "pending-review",
          });
          return {
            kind: "completed",
            durationMs: 5,
            runArtifactPath: writeAgentStepArtifact({
              workingDir,
              workflowName,
              agentStepId: "solve-noisy-skill",
              promptText: [
                "Solve the ticket.",
                "Outdated Ticket Procedure",
                "Set routing to pending-review when optional fields exist.",
              ].join("\n"),
              inputTokens: 1280,
              outputTokens: 125,
            }),
          };
        }
        completeTicketNormalization({
          workingDir,
          valid: false,
          routing: "review",
        });
        return {
          kind: "completed",
          durationMs: 5,
          runArtifactPath: writeAgentStepArtifact({
            workingDir,
            workflowName,
            agentStepId: "solve-no-skill",
            promptText: "Solve the ticket without additional skill guidance.",
            inputTokens: 900,
            outputTokens: 120,
          }),
        };
      },
    };

    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir: runsRoot,
      runIndex: 0,
      repeatCount: 1,
    });

    expect(calls).toEqual([
      "skill-ablation-no-skill",
      "skill-ablation-focused-skill",
      "skill-ablation-noisy-skill",
    ]);
    expect(report.run.outcome).toBe("pass");
    expect(report.run.skillAblation?.directionPassed).toBe(true);
    expect(report.objectiveMetrics.map((metric) => metric.name)).toEqual([
      "no-skill.predicate_pass_rate",
      "focused-skill.predicate_pass_rate",
      "noisy-skill.predicate_pass_rate",
    ]);

    const raw = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "fixture-run.json"), "utf-8"),
    ) as {
      fixture: { mode: string; workingDir: string };
      outcome: string;
      skillAblation: {
        directionPassed: boolean;
        variants: Array<{
          id: string;
          observedOutcome: string;
          expectationPassed: boolean;
          promptResolution: {
            selectedSkills: string[];
            resolvedSkills: Array<{
              name: string;
              expectedProvenance: string;
              resolved: boolean;
              provenance: string;
              importedFiles: string[];
            }>;
            agentInputFound: boolean;
            requiredNeedles: Array<{ passed: boolean }>;
            forbiddenNeedles: Array<{ passed: boolean }>;
          };
          objectiveMetrics: Array<{ name: string; value: number }>;
          usage: {
            inputTokens: number | null;
            outputTokens: number | null;
            totalCostUsd: number | null;
          };
        }>;
      };
    };
    expect(raw.fixture.mode).toBe("skill-ablation");
    expect(raw.outcome).toBe("pass");
    expect(raw.skillAblation.directionPassed).toBe(true);
    const byId = new Map(
      raw.skillAblation.variants.map((variant) => [variant.id, variant]),
    );
    expect(byId.get("no-skill")).toMatchObject({
      observedOutcome: "fail",
      expectationPassed: true,
      promptResolution: {
        selectedSkills: [],
        resolvedSkills: [],
        agentInputFound: true,
      },
    });
    expect(byId.get("focused-skill")).toMatchObject({
      observedOutcome: "pass",
      expectationPassed: true,
      usage: {
        inputTokens: 1350,
        outputTokens: 130,
        totalCostUsd: 0.01,
      },
    });
    expect(byId.get("focused-skill")?.promptResolution.resolvedSkills[0]).toMatchObject({
      name: "focused-procedure",
      expectedProvenance: "imported",
      resolved: true,
      provenance: "imported",
      importedFiles: ["SKILL.md"],
    });
    expect(
      byId
        .get("focused-skill")
        ?.promptResolution.requiredNeedles.every((needle) => needle.passed),
    ).toBe(true);
    expect(
      byId
        .get("noisy-skill")
        ?.promptResolution.forbiddenNeedles.every((needle) => needle.passed),
    ).toBe(true);
    expect(byId.get("focused-skill")?.objectiveMetrics[0]).toMatchObject({
      name: "focused-skill.predicate_pass_rate",
      value: 1,
    });
    expect(byId.get("no-skill")?.objectiveMetrics[0].value).toBeLessThan(1);
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("rejects malformed imported skill metadata before executing a skill-ablation variant", async () => {
    writeSkillAblationFixture(fixturesRoot, {
      id: "skill-ablation-invalid-skill",
      focusedSkillFrontmatter: "name: focused-procedure\nallowed-tools: [Read]",
    });
    const fixture = loadFixture(fixturesRoot, "skill-ablation-invalid-skill");
    let executorCalls = 0;
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async () => {
        executorCalls++;
        return { kind: "completed", durationMs: 5, runArtifactPath: null };
      },
    };

    await expect(
      runFixture({
        fixture,
        executor,
        executionProfile: TEST_EXECUTION_PROFILE,
        runArtifactBaseDir: runsRoot,
        runIndex: 0,
        repeatCount: 1,
      }),
    ).rejects.toThrow(/unsupported skill tool-policy frontmatter "allowed-tools"/);
    expect(executorCalls).toBe(0);
  });

  it("checks skill-ablation variant working dirs stay inside the parent before materializing", async () => {
    writeSkillAblationFixture(fixturesRoot, {
      id: "skill-ablation-mutated-variant-id",
    });
    const fixture = loadFixture(fixturesRoot, "skill-ablation-mutated-variant-id");
    if (!isSkillAblationFixtureSpec(fixture.spec)) {
      throw new Error("expected skill-ablation fixture");
    }
    const escapeName = `kota-eval-variant-escape-${process.pid}-${Date.now()}`;
    const escapePath = join(tmpdir(), escapeName);
    rmSync(escapePath, { recursive: true, force: true });
    fixture.spec.variants[0].id = `../${escapeName}`;
    let executorCalls = 0;
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async () => {
        executorCalls++;
        return { kind: "completed", durationMs: 5, runArtifactPath: null };
      },
    };

    try {
      await expect(
        runFixture({
          fixture,
          executor,
          executionProfile: TEST_EXECUTION_PROFILE,
          runArtifactBaseDir: runsRoot,
          runIndex: 0,
          repeatCount: 1,
        }),
      ).rejects.toThrow(/working directory must stay inside/);
      expect(executorCalls).toBe(0);
      expect(existsSync(escapePath)).toBe(false);
    } finally {
      rmSync(escapePath, { recursive: true, force: true });
    }
  });
});
