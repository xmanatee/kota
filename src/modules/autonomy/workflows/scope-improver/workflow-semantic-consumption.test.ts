import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { inspectScopeSemanticBoundary } from "../dispatcher/semantic-reflection.js";
import { computeScopeContentFingerprint } from "./scope-fingerprint.js";
import { collectScopeImprovementInputs } from "./scope-improvement.js";
import {
  completeScopeImprovementInput,
  deferScopeImprovementInput,
  emptyScopeImprovementState,
  reserveScopeImprovementInput,
} from "./scope-improvement-state.js";
import { scopePolicySnapshotForTest } from "./scope-policy-test-support.js";
import {
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

  it("reserves one later review only after durable guidance changes", () => {
    const projectDir = track("policy-change");
    const scopeId = deriveDirectoryScopeId(projectDir);
    const first = computeScopeContentFingerprint(
      projectDir,
      scopePolicySnapshotForTest(projectDir).policy,
    );
    const consumed = {
      ...emptyScopeImprovementState(scopeId),
      lastRunAt: SCOPE_TEST_NOW.toISOString(),
      consumedFingerprint: first.fingerprint,
    };
    expect(inspectScopeSemanticBoundary({
      projectDir,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
      state: consumed,
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
      state: consumed,
    });
    expect(boundary).toMatchObject({
      shouldEmit: true,
      payload: { boundary: "content-policy-changed", automatic: true },
      nextState: {
        pendingBoundary: "content-policy-changed",
        pendingDelivery: "queued",
      },
    });
  });

  it("keeps explicit requests independent of the automatic fingerprint", () => {
    const projectDir = track("explicit");
    const scopeId = deriveDirectoryScopeId(projectDir);
    const fingerprint = computeScopeContentFingerprint(
      projectDir,
      scopePolicySnapshotForTest(projectDir).policy,
    );
    const state = {
      ...emptyScopeImprovementState(scopeId),
      consumedFingerprint: fingerprint.fingerprint,
    };
    const inputs = collectScopeImprovementInputs({
      projectDir,
      state,
      trigger: {
        event: "autonomy.scope-improvement.requested",
        schemaRef: null,
        payload: {
          boundary: "explicit-request",
          fingerprint: fingerprint.fingerprint,
          evidenceRefs: fingerprint.refs,
          reason: "owner requested a fresh review",
        },
      },
      now: SCOPE_TEST_NOW,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    });

    expect(inputs.alreadyConsumed).toBe(false);
    expect(inputs.triggerKind).toBe("explicit-request");
  });

  it("persists deferred automatic input and resumes it after cleanup", () => {
    const projectDir = track("dirty-auto");
    const scopeId = deriveDirectoryScopeId(projectDir);
    const fingerprint = computeScopeContentFingerprint(
      projectDir,
      scopePolicySnapshotForTest(projectDir).policy,
    );
    const pending = reserveScopeImprovementInput(
      emptyScopeImprovementState(scopeId),
      {
        fingerprint: fingerprint.fingerprint,
        boundary: "initial-onboarding",
        delivery: "queued",
        deliveryAttempt: 0,
      },
    );
    const inputs = collectScopeImprovementInputs({
      projectDir,
      state: pending,
      trigger: {
        event: "autonomy.scope-improvement.requested",
        schemaRef: null,
        payload: {
          automatic: true,
          boundary: "initial-onboarding",
          fingerprint: fingerprint.fingerprint,
        },
      },
      now: SCOPE_TEST_NOW,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    });
    const deferred = deferScopeImprovementInput(pending, inputs);
    expect(deferred).toMatchObject({
      consumedFingerprint: null,
      pendingFingerprint: fingerprint.fingerprint,
      pendingDelivery: "deferred",
      pendingDeliveryAttempt: 1,
    });

    const resumed = inspectScopeSemanticBoundary({
      projectDir,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
      state: deferred,
    });
    expect(resumed).toMatchObject({
      shouldEmit: true,
      payload: {
        boundary: "initial-onboarding",
        deliveryAttempt: 1,
      },
      nextState: {
        pendingDelivery: "queued",
        pendingDeliveryAttempt: 1,
      },
    });

    const completed = completeScopeImprovementInput({
      current: resumed.nextState!,
      inputs,
      actions: [],
    });
    expect(completed).toMatchObject({
      consumedFingerprint: fingerprint.fingerprint,
      pendingFingerprint: null,
      pendingDelivery: null,
    });
  });
});
