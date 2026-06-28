import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runScenarioAcrossHarnesses, runScenarioOnHarness } from "./runner.js";
import { cleanupRunnerTestState, makeHarness, setupRunnerTestState, writeStagedScenario } from "./runner.test-support.js";
import { loadScenario } from "./scenario.js";

describe("harness-parity runner staged scenarios", () => {
let scenariosRoot: string;
let outRoot: string;

beforeEach(() => {
  ({ scenariosRoot, outRoot } = setupRunnerTestState());
});

afterEach(() => {
  cleanupRunnerTestState({ scenariosRoot, outRoot });
});

  it("executes staged scenarios sequentially on one harness working tree and writes per-stage artifacts", async () => {
    writeStagedScenario(scenariosRoot);
    const scenario = loadScenario(scenariosRoot, "staged-upgrade");
    const prompts: string[] = [];
    const harness = makeHarness("staged-fixing", (workingDir, options) => {
      prompts.push(options.prompt);
      if (options.prompt.includes("stage 1")) {
        writeFileSync(join(workingDir, "state.js"), 'exports.state = () => "v2";\n');
        return;
      }
      const inherited = readFileSync(join(workingDir, "state.js"), "utf-8");
      writeFileSync(
        join(workingDir, "state.js"),
        inherited.includes('"v2"')
          ? 'exports.state = () => "v2+v3";\n'
          : 'exports.state = () => "missing-v2";\n',
      );
    });

    const artifact = await runScenarioOnHarness({
      scenario,
      harness,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    expect(prompts).toEqual([
      "stage 1 release notes: write v2",
      "stage 2 release notes: preserve v2 and write v3",
    ]);
    expect(artifact.stageMode).toBe("staged");
    expect(artifact.verification.passed).toBe(true);
    expect(artifact.changedFiles).toEqual(["state.js"]);
    expect(artifact.stagedSummary).toMatchObject({
      mode: "staged",
      passed: true,
      stageCount: 2,
    });
    expect(artifact.stages.map((stage) => stage.stageId)).toEqual([
      "upgrade-v2",
      "upgrade-v3",
    ]);
    expect(artifact.stages[0]?.verification.passed).toBe(true);
    expect(artifact.stages[1]?.verification.passed).toBe(true);

    const stageOneDir = join(artifact.artifactDir, "stages", "upgrade-v2");
    const stageTwoDir = join(artifact.artifactDir, "stages", "upgrade-v3");
    expect(readFileSync(join(stageOneDir, "prompt.txt"), "utf-8")).toContain(
      "stage 1 release notes",
    );
    expect(readFileSync(join(stageOneDir, "diff.patch"), "utf-8")).toContain(
      "state.js",
    );
    expect(
      JSON.parse(readFileSync(join(stageTwoDir, "verification.json"), "utf-8")),
    ).toMatchObject({ passed: true, command: "node test-v3.js" });
    expect(readFileSync(join(stageTwoDir, "trace-summary.md"), "utf-8")).toContain(
      "- verification: pass",
    );

    const meta = JSON.parse(
      readFileSync(join(artifact.artifactDir, "run-meta.json"), "utf-8"),
    );
    expect(meta.stagedSummary).toMatchObject({
      mode: "staged",
      passed: true,
      stageCount: 2,
    });
    expect(meta.stages[0]).toMatchObject({
      stageId: "upgrade-v2",
      verification: { passed: true },
    });
    expect(readFileSync(join(artifact.artifactDir, "trace-summary.md"), "utf-8")).toContain(
      "## Stages",
    );
    expect(
      JSON.parse(readFileSync(join(artifact.artifactDir, "trajectory.json"), "utf-8")),
    ).toMatchObject({
      status: "staged",
      stages: [
        { stageId: "upgrade-v2" },
        { stageId: "upgrade-v3" },
      ],
    });
    expect(
      readFileSync(join(artifact.artifactDir, "trajectory-summary.md"), "utf-8"),
    ).toContain("# Staged Trajectory");
  });

  it("reports staged failures in per-stage artifacts and parity summaries", async () => {
    writeStagedScenario(scenariosRoot);
    const scenario = loadScenario(scenariosRoot, "staged-upgrade");
    const harness = makeHarness("staged-partial", (workingDir, options) => {
      if (options.prompt.includes("stage 1")) {
        writeFileSync(join(workingDir, "state.js"), 'exports.state = () => "v2";\n');
      }
    });

    const artifacts = await runScenarioAcrossHarnesses({
      scenario,
      harnesses: [harness],
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    const artifact = artifacts[0]!;
    expect(artifact.verification.passed).toBe(false);
    expect(artifact.stages[0]?.verification.passed).toBe(true);
    expect(artifact.stages[1]?.verification.passed).toBe(false);
    expect(artifact.stagedSummary.passed).toBe(false);

    const stageTwoVerification = JSON.parse(
      readFileSync(
        join(artifact.artifactDir, "stages", "upgrade-v3", "verification.json"),
        "utf-8",
      ),
    );
    expect(stageTwoVerification).toMatchObject({
      command: "node test-v3.js",
      passed: false,
    });

    const parity = JSON.parse(
      readFileSync(join(outRoot, "staged-upgrade", "parity.json"), "utf-8"),
    );
    expect(parity.stageMode).toBe("staged");
    expect(parity.artifacts[0].verificationPassed).toBe(false);
    expect(parity.artifacts[0].stagedSummary).toMatchObject({
      mode: "staged",
      passed: false,
      stageCount: 2,
    });
    expect(parity.artifacts[0].stagedSummary.stages[1]).toMatchObject({
      stageId: "upgrade-v3",
      verificationPassed: false,
    });
  });
});
