import {
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "#core/workflow/validation.js";
import { inspectScopeSemanticBoundary } from "../dispatcher/semantic-reflection.js";
import { computeScopeContentFingerprint } from "./scope-fingerprint.js";
import {
  collectScopeImprovementInputs,
  prepareInitialScopeImprovementRequest,
} from "./scope-improvement.js";
import { readScopeImprovementState } from "./scope-improvement-state.js";
import { scopePolicySnapshotForTest } from "./scope-policy-test-support.js";
import scopeImproverWorkflow from "./workflow.js";
import {
  makeScopeFixture,
  runScopeFixtureGit,
  SCOPE_TEST_NOW,
} from "./workflow.test-helpers.js";

describe("scope-improver semantic boundaries", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  function track(label: string): string {
    const projectDir = makeScopeFixture(label);
    projectDirs.push(projectDir);
    return projectDir;
  }

  it("registers only explicit semantic requests plus non-agent recovery", () => {
    const registered = validateWorkflowDefinitions([
      registerWorkflowDefinition(
        "src/modules/autonomy/workflows/scope-improver/workflow.ts",
        scopeImproverWorkflow,
      ),
    ])[0]!;
    expect(registered.triggers).toEqual([
      expect.objectContaining({
        event: "autonomy.scope-improvement.requested",
        queueMode: "all",
        cooldownMs: 0,
      }),
      expect.objectContaining({
        event: "autonomy.scope-improvement.changed",
        queueMode: "latest",
        cooldownMs: 0,
      }),
      expect.objectContaining({ event: "runtime.recovered" }),
    ]);
    expect(registered.triggers.some((trigger) => trigger.schedule || trigger.batch))
      .toBe(false);
  });

  it("consumes initial onboarding once and makes unchanged restart a no-op", async () => {
    const projectDir = track("onboarding");
    const initial = prepareInitialScopeImprovementRequest({
      projectDir,
      requestedBy: "scope-onboarding",
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    });
    expect(initial).toMatchObject({
      automatic: true,
      boundary: "initial-onboarding",
      fingerprint: expect.stringMatching(/^scope-content:/),
    });
    expect(prepareInitialScopeImprovementRequest({
      projectDir,
      requestedBy: "scope-onboarding-restart",
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    })).toBeNull();
    const trigger = {
      event: "autonomy.scope-improvement.requested",
      schemaRef: null,
      payload: initial!,
    };
    const first = await new WorkflowTestHarness(scopeImproverWorkflow, {
      projectDir,
      trigger,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    }).run();
    expect(first.status).toBe("success");
    expect(readdirSync(join(projectDir, ".kota", "owner-questions"))).toHaveLength(1);

    const secondInputs = collectScopeImprovementInputs({
      projectDir,
      trigger,
      now: SCOPE_TEST_NOW,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    });
    expect(secondInputs.alreadyConsumed).toBe(true);
    expect(prepareInitialScopeImprovementRequest({
      projectDir,
      requestedBy: "scope-onboarding-restart",
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    })).toBeNull();
    const second = await new WorkflowTestHarness(scopeImproverWorkflow, {
      projectDir,
      trigger,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    }).run();
    expect(second.status).toBe("success");
    expect(readdirSync(join(projectDir, ".kota", "owner-questions"))).toHaveLength(1);
  });

  it("coalesces changed guidance into a pending onboarding review", async () => {
    const projectDir = track("onboarding-coalescing");
    const initial = prepareInitialScopeImprovementRequest({
      projectDir,
      requestedBy: "scope-onboarding",
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    });
    expect(initial?.fingerprint).toBeTruthy();

    writeFileSync(
      join(projectDir, "AGENTS.md"),
      "# Scope\n\n- Preserve the latest owner policy.\n",
    );
    runScopeFixtureGit(projectDir, ["add", "AGENTS.md"]);
    runScopeFixtureGit(projectDir, [
      "-c",
      "user.email=kota@example.test",
      "-c",
      "user.name=KOTA Test",
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "-m",
      "change guidance before onboarding consumption",
    ]);
    const current = computeScopeContentFingerprint(
      projectDir,
      scopePolicySnapshotForTest(projectDir).policy,
    );
    expect(current.fingerprint).not.toBe(initial?.fingerprint);

    const replacement = inspectScopeSemanticBoundary({
      projectDir,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    });
    expect(replacement).toMatchObject({
      shouldEmit: false,
      reason: "initial onboarding request is already queued and will read current inputs",
    });
    expect(inspectScopeSemanticBoundary({
      projectDir,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    })).toMatchObject({
      shouldEmit: false,
      reason: "initial onboarding request is already queued and will read current inputs",
    });

    const staleTrigger = {
      event: "autonomy.scope-improvement.requested",
      schemaRef: null,
      payload: initial!,
    };
    const refreshedInputs = collectScopeImprovementInputs({
      projectDir,
      trigger: staleTrigger,
      now: SCOPE_TEST_NOW,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    });
    expect(refreshedInputs.semanticInput).toMatchObject({
      automatic: true,
      fingerprint: current.fingerprint,
      evidenceRefs: expect.arrayContaining(["AGENTS.md"]),
    });

    const result = await new WorkflowTestHarness(scopeImproverWorkflow, {
      projectDir,
      trigger: staleTrigger,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    }).run();
    expect(result.status).toBe("success");
    expect(
      readScopeImprovementState(projectDir, deriveDirectoryScopeId(projectDir)),
    ).toMatchObject({
      consumedFingerprint: current.fingerprint,
      pendingFingerprint: null,
    });
    expect(inspectScopeSemanticBoundary({
      projectDir,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    }).shouldEmit).toBe(false);
  });
});
