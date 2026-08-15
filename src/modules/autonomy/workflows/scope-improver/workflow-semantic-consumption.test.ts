import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { inspectScopeSemanticBoundary } from "../dispatcher/semantic-reflection.js";
import { computeScopeContentFingerprint } from "./scope-fingerprint.js";
import {
  collectScopeImprovementInputs,
  prepareInitialScopeImprovementRequest,
  SCOPE_IMPROVEMENT_ARTIFACT,
} from "./scope-improvement.js";
import { readScopeImprovementState } from "./scope-improvement-state.js";
import { scopePolicySnapshotForTest } from "./scope-policy-test-support.js";
import scopeImproverWorkflow from "./workflow.js";
import {
  automaticScopeRequest,
  makeScopeFixture,
  runScopeFixtureGit,
  SCOPE_TEST_NOW,
} from "./workflow.test-helpers.js";

describe("scope-improver semantic consumption", () => {
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

  it("queues one later review only after durable scope guidance changes", async () => {
    const projectDir = track("policy-change");
    await new WorkflowTestHarness(scopeImproverWorkflow, {
      projectDir,
      trigger: automaticScopeRequest(projectDir, "initial-onboarding"),
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    }).run();

    expect(inspectScopeSemanticBoundary({
      projectDir,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    }).shouldEmit).toBe(false);
    writeFileSync(join(projectDir, "AGENTS.md"), "# Scope\n\n- Preserve owner policy.\n");
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
      "change scope guidance",
    ]);

    const boundary = inspectScopeSemanticBoundary({
      projectDir,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    });
    expect(boundary).toMatchObject({
      shouldEmit: true,
      payload: { boundary: "content-policy-changed", automatic: true },
    });
    const result = await new WorkflowTestHarness(scopeImproverWorkflow, {
      projectDir,
      trigger: {
        event: "autonomy.scope-improvement.changed",
        schemaRef: null,
        payload: boundary.payload!,
      },
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    }).run();
    expect(result.status).toBe("success");
    expect(inspectScopeSemanticBoundary({
      projectDir,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    }).shouldEmit).toBe(false);
    const artifact = JSON.parse(
      readFileSync(
        join(projectDir, ".kota", "runs", "harness", SCOPE_IMPROVEMENT_ARTIFACT),
        "utf8",
      ),
    );
    expect(artifact.inputs.semanticInput.fingerprint).toBe(
      boundary.payload?.fingerprint,
    );
  });

  it("lets an explicit request run even when the fingerprint is unchanged", async () => {
    const projectDir = track("explicit");
    const fingerprint = computeScopeContentFingerprint(
      projectDir,
      scopePolicySnapshotForTest(projectDir).policy,
    );
    const trigger = {
      event: "autonomy.scope-improvement.requested",
      schemaRef: null,
      payload: {
        boundary: "explicit-request",
        fingerprint: fingerprint.fingerprint,
        evidenceRefs: fingerprint.refs,
        reason: "owner requested a fresh review",
      },
    };
    await new WorkflowTestHarness(scopeImproverWorkflow, {
      projectDir,
      trigger,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    }).run();
    const inputs = collectScopeImprovementInputs({
      projectDir,
      trigger,
      now: SCOPE_TEST_NOW,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    });
    expect(inputs.alreadyConsumed).toBe(false);
    expect(inputs.triggerKind).toBe("explicit-request");
    expect(deriveDirectoryScopeId(projectDir)).toBe(inputs.scope.scopeId);
    expect(
      readScopeImprovementState(projectDir, deriveDirectoryScopeId(projectDir)),
    ).toMatchObject({
      consumedFingerprint: null,
      pendingFingerprint: null,
    });
    const onboarding = prepareInitialScopeImprovementRequest({
      projectDir,
      requestedBy: "scope-onboarding-after-explicit-review",
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    });
    expect(onboarding).toMatchObject({
      automatic: true,
      boundary: "initial-onboarding",
    });
    await new WorkflowTestHarness(scopeImproverWorkflow, {
      projectDir,
      trigger,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    }).run();
    expect(
      readScopeImprovementState(projectDir, deriveDirectoryScopeId(projectDir)),
    ).toMatchObject({
      consumedFingerprint: null,
      pendingFingerprint: onboarding?.fingerprint,
      pendingBoundary: "initial-onboarding",
      pendingDelivery: "queued",
    });
  });

  it("parks automatic recommendations until canonical cleanup", async () => {
    const projectDir = track("dirty-auto");
    const initial = prepareInitialScopeImprovementRequest({
      projectDir,
      requestedBy: "scope-onboarding",
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    });
    writeFileSync(join(projectDir, "scratch.txt"), "uncommitted work\n", "utf8");

    const first = await new WorkflowTestHarness(scopeImproverWorkflow, {
      projectDir,
      trigger: {
        event: "autonomy.scope-improvement.requested",
        schemaRef: null,
        payload: initial!,
      },
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    }).run();

    expect(first.steps["apply-recommendations"].status).toBe("skipped");
    expect(first.steps["record-semantic-consumption"].output).toEqual({
      recorded: false,
      reason: "semantic scope input deferred until the canonical worktree is clean",
    });
    expect(
      readScopeImprovementState(projectDir, deriveDirectoryScopeId(projectDir)),
    ).toMatchObject({
      consumedFingerprint: null,
      pendingFingerprint: initial?.fingerprint,
      pendingBoundary: "initial-onboarding",
      pendingDelivery: "deferred",
      pendingDeliveryAttempt: 1,
    });

    rmSync(join(projectDir, "scratch.txt"));
    const resumed = inspectScopeSemanticBoundary({
      projectDir,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    });
    expect(resumed).toMatchObject({
      shouldEmit: true,
      payload: {
        automatic: true,
        boundary: "initial-onboarding",
        fingerprint: initial?.fingerprint,
        deliveryAttempt: 1,
        idempotencyKey: expect.stringContaining(":1"),
      },
    });
  });
});
