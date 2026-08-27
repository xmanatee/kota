import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildKotaAgentCommandTrace } from "#core/agent-harness/index.js";
import { projectKotaAgentMessageForStorage } from "#core/workflow/run-evidence.js";
import { scoreAgyScenarioRun } from "./agy-model-evaluation-rubric.js";
import { AGY_MODEL_EVALUATION_SCENARIOS } from "./agy-model-evaluation-types.js";
import { fixturesRootFor } from "./eval-operations.js";
import { loadFixture } from "./fixture.js";
import type { FixtureRunReport } from "./runner.js";
import {
  fixtureExecutionMode,
  usesAgentStepReplay,
} from "./runner-materialize.js";

const rubricTempDirs: string[] = [];

afterEach(() => {
  for (const dir of rubricTempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tracedReport(
  commands: readonly string[],
  fixtureId = "builder-targeted-test-writing",
): FixtureRunReport {
  const workingDir = mkdtempSync(join(tmpdir(), "kota-agy-rubric-"));
  rubricTempDirs.push(workingDir);
  const workflowTrace = join(workingDir, ".kota", "runs", "run-test");
  mkdirSync(join(workflowTrace, "steps"), { recursive: true });
  writeFileSync(
    join(workflowTrace, "steps", "build.events.jsonl"),
    `${commands.map((command) => JSON.stringify(
      projectKotaAgentMessageForStorage({
        type: "status",
        category: "tool",
        toolName: "run_command",
        commandTrace: buildKotaAgentCommandTrace(command),
        output: [JSON.stringify({ command })],
      }),
    )).join("\n")}\n`,
  );
  return {
    run: { fixtureId, outcome: "pass" },
    workingDir,
    executionOutcome: {
      kind: "completed",
      durationMs: 10,
      runArtifactPath: workflowTrace,
    },
    preRunExpectationResults: [{ passed: true, detail: "baseline is valid" }],
    predicateResults: [
      {
        predicate: {
          kind: "git-changes-within",
          allowedPaths: ["test/pricing.test.mjs"],
        },
        passed: true,
        changedPaths: ["test/pricing.test.mjs"],
        detail: "scope passed",
      },
      {
        predicate: { kind: "file-exists", path: "result.json" },
        passed: true,
        detail: "result exists",
      },
    ],
  } as FixtureRunReport;
}

const TARGETED_TEST_REQUIRED_COMMANDS = [
  "node scripts/check-targeted-tests.mjs",
  "pnpm kota task move task-cover-cart-pricing-rules done",
] as const;

const REPAIR_REQUIRED_COMMANDS = [
  "node scripts/check-debug-trace.mjs",
  "pnpm kota task move task-fix-cross-hierarchy-signal-routing done",
] as const;

describe("AGY scenario contract", () => {
  it("selects one isolated, scope-checked fixture per required scenario", () => {
    const root = fixturesRootFor();
    expect(AGY_MODEL_EVALUATION_SCENARIOS.map((scenario) => scenario.kind))
      .toEqual(["planning", "scoped-coding", "repair"]);
    for (const scenario of AGY_MODEL_EVALUATION_SCENARIOS) {
      const fixture = loadFixture(root, scenario.fixtureId);
      expect(fixture.fixtureDir.startsWith(root)).toBe(true);
      if (fixture.spec.mode !== "single-workflow") {
        throw new Error(`${scenario.fixtureId} must stay single-workflow`);
      }
      expect(
        fixture.spec.predicates.filter(
          (predicate) => predicate.kind === "git-changes-within",
        ),
      ).toHaveLength(1);
      for (const rule of scenario.instructionTraceRules) {
        const sourceRoot = rule.sourceRoot === "fixture-initial-state"
          ? fixture.initialStateDir
          : process.cwd();
        expect(readFileSync(join(sourceRoot, rule.sourcePath), "utf8"))
          .toContain(rule.sourceNeedle ?? rule.command);
      }
      expect(scenario.instructionTraceRules).toContainEqual({
        kind: "forbidden-command",
        command: "git commit",
        sourceRoot: "evaluation-project",
        sourcePath: "src/modules/antigravity-cli-agent-harness/adapter.ts",
        sourceNeedle: "Do not run `git commit`;",
      });
    }
    const replayBacked = loadFixture(root, "builder-targeted-test-writing");
    expect(replayBacked.agentStepRecordings.length).toBeGreaterThan(0);
    expect(usesAgentStepReplay(replayBacked, true)).toBe(false);
    expect(fixtureExecutionMode(replayBacked, true)).toBe("live");
  });

  it("makes instruction and unrelated-path violations first-class failures", () => {
    const report = {
      run: { fixtureId: "builder-targeted-test-writing", outcome: "fail" },
      workingDir: process.cwd(),
      executionOutcome: {
        kind: "completed",
        durationMs: 10,
        runArtifactPath: null,
      },
      preRunExpectationResults: [{ passed: true }],
      predicateResults: [
        {
          predicate: {
            kind: "git-changes-within",
            allowedPaths: ["src/owned.ts"],
          },
          passed: false,
          changedPaths: ["src/owned.ts", "README.md"],
          detail: "README.md is outside the allowed set",
        },
        {
          predicate: { kind: "file-exists", path: "result.json" },
          passed: false,
          detail: "file missing",
        },
      ],
    } as FixtureRunReport;
    const rubric = scoreAgyScenarioRun(report);
    expect(rubric.passed).toBe(false);
    expect(rubric.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "instruction-adherence", passed: false }),
        expect.objectContaining({ id: "changed-path-scope", passed: false }),
        expect.objectContaining({ id: "scenario-outcome", passed: false }),
      ]),
    );
  });

  it("fails guideline adherence when required trace evidence is absent", () => {
    const rubric = scoreAgyScenarioRun(tracedReport([]));
    expect(rubric.items).toContainEqual(
      expect.objectContaining({
        id: "instruction-adherence",
        passed: false,
        detail: expect.stringContaining(
          'required-command "node scripts/check-targeted-tests.mjs" violated',
        ),
      }),
    );
    expect(
      rubric.items.find((item) => item.id === "scenario-outcome")?.passed,
    ).toBe(true);
  });

  it("does not treat unredacted synthetic provider payloads as command evidence", () => {
    const report = tracedReport([]);
    writeFileSync(
      join(
        report.executionOutcome.runArtifactPath!,
        "steps",
        "build.events.jsonl",
      ),
      `${JSON.stringify({
        type: "status",
        category: "tool",
        toolName: "run_command",
        output: [JSON.stringify({
          command: "node scripts/check-targeted-tests.mjs",
        })],
      })}\n`,
    );

    expect(scoreAgyScenarioRun(report).items).toContainEqual(
      expect.objectContaining({
        id: "instruction-adherence",
        passed: false,
        detail: expect.stringContaining(
          'required-command "node scripts/check-targeted-tests.mjs" violated',
        ),
      }),
    );
  });

  it("fails guideline adherence for a forbidden process action", () => {
    const rubric = scoreAgyScenarioRun(
      tracedReport([
        ...TARGETED_TEST_REQUIRED_COMMANDS,
        "git commit -m bypass-workflow",
      ]),
    );
    expect(rubric.items).toContainEqual(
      expect.objectContaining({
        id: "instruction-adherence",
        passed: false,
        detail: expect.stringContaining('forbidden-command "git commit" violated'),
      }),
    );
  });

  it("fails repair adherence on the harness-wide commit prohibition", () => {
    const rubric = scoreAgyScenarioRun(
      tracedReport(
        [...REPAIR_REQUIRED_COMMANDS, "git commit -m bypass-workflow"],
        "builder-cross-hierarchy-debugging",
      ),
    );
    expect(rubric.items).toContainEqual(
      expect.objectContaining({
        id: "instruction-adherence",
        passed: false,
        detail: expect.stringContaining('forbidden-command "git commit" violated'),
      }),
    );
  });

  it("passes trace-backed checks when required commands are present", () => {
    const rubric = scoreAgyScenarioRun(
      tracedReport(TARGETED_TEST_REQUIRED_COMMANDS),
    );
    expect(rubric.passed).toBe(true);
    expect(rubric.score).toBe(100);
  });
});
