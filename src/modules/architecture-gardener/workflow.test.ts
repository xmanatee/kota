import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import { GARDENER_STATE_KEY } from "./gardener-state.js";
import type { ArchitectureGardenerRunState } from "./types.js";
import architectureGardenerWorkflow, {
  ARCHITECTURE_GARDENER_RUN_ARTIFACT,
  ARCHITECTURE_REVIEW_REQUESTED_EVENT,
} from "./workflow.js";

function runGit(cwd: string, args: string[]) {
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("Architecture Gardener Workflow", () => {
  let testWorkspace: string;

  beforeEach(() => {
    testWorkspace = mkdtempSync(join(tmpdir(), "kota-gardener-wf-test-"));
    mkdirSync(join(testWorkspace, "src", "core"), { recursive: true });
    mkdirSync(join(testWorkspace, "src", "modules", "foo"), { recursive: true });
    mkdirSync(join(testWorkspace, "data", "tasks"), { recursive: true });
    mkdirSync(join(testWorkspace, ".kota"), { recursive: true });

    writeFileSync(
      join(testWorkspace, "src", "core", "clean.ts"),
      "export const coreUtil = () => true;\n",
      "utf-8",
    );
    writeFileSync(
      join(testWorkspace, "src", "modules", "foo", "index.ts"),
      "export default { name: \"foo\", dependencies: [] };\n",
      "utf-8",
    );
    writeFileSync(
      join(testWorkspace, "package.json"),
      `${JSON.stringify({ name: "test-pkg", version: "1.0.0", scripts: { "validate-tasks": "echo ok" } }, null, 2)}\n`,
      "utf-8",
    );
    writeFileSync(join(testWorkspace, ".gitignore"), ".kota/\n", "utf-8");

    runGit(testWorkspace, ["init", "--quiet"]);
    runGit(testWorkspace, ["add", "."]);
    runGit(testWorkspace, [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "-m",
      "init",
    ]);
  });

  afterEach(() => {
    rmSync(testWorkspace, { recursive: true, force: true });
  });

  it("executes workflow on explicit request and stages an implementation task", async () => {
    const transactionalState = createTestTransactionalRunState();
    const trigger = {
      event: ARCHITECTURE_REVIEW_REQUESTED_EVENT,
      schemaRef: null,
      payload: {
        targetScope: "src/modules/foo",
        reason: "Simplify foo module architecture",
      },
    };

    const run = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace,
      trigger,
      ports: { state: transactionalState },
    }).run();

    expect(run.status).toBe("success");
    const artifactPath = join(run.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT);
    expect(existsSync(artifactPath)).toBe(true);

    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
    expect(artifact.evaluations.length).toBeGreaterThan(0);
    expect(artifact.staged).toBeDefined();
    expect(artifact.staged.staged).toBe(true);

    // Commit message written
    expect(existsSync(join(run.runDirPath, "commit-message.txt"))).toBe(true);

    // State updated
    const snapshot = transactionalState.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY);
    expect(snapshot.value).toBeDefined();
    expect(snapshot.value?.dispositions["src/modules/foo"]?.disposition).toBe("accepted");
  });

  it("suppresses unchanged evidence on subsequent runs", async () => {
    const transactionalState = createTestTransactionalRunState();
    const trigger = {
      event: ARCHITECTURE_REVIEW_REQUESTED_EVENT,
      schemaRef: null,
      payload: {},
    };

    // First run
    const run1 = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace,
      trigger,
      ports: { state: transactionalState },
    }).run();
    expect(run1.status).toBe("success");

    // Second run with unchanged observations -> no new tasks staged
    const run2 = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace,
      trigger,
      ports: { state: transactionalState },
    }).run();
    expect(run2.status).toBe("success");

    const artifact2 = JSON.parse(
      readFileSync(join(run2.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf-8"),
    );
    expect(artifact2.staged).toBeNull();
  });
});
