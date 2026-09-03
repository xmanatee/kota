import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  const scopeRoots: string[] = [];

  afterEach(() => {
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  function track(label: string): string {
    const workspaceRoot = makeScopeFixture(label);
    scopeRoots.push(workspaceRoot);
    return workspaceRoot;
  }

  function trackDirectory(label: string): string {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), `kota-scope-semantic-directory-${label}-`),
    );
    scopeRoots.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, ".kota"), { recursive: true });
    return workspaceRoot;
  }

  it("reserves one later review only after durable guidance changes", () => {
    const workspaceRoot = track("policy-change");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const first = computeScopeContentFingerprint(
      workspaceRoot,
      scopePolicySnapshotForTest(workspaceRoot).policy,
    );
    const consumed = {
      ...emptyScopeImprovementState(scopeId),
      lastRunAt: SCOPE_TEST_NOW.toISOString(),
      consumedFingerprint: first.fingerprint,
    };
    expect(inspectScopeSemanticBoundary({
      workspaceRoot,
      scopeRoot: workspaceRoot,
      scopeId,
      stateDir: join(workspaceRoot, ".kota"),
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
      state: consumed,
    }).shouldEmit).toBe(false);

    writeFileSync(join(workspaceRoot, "AGENTS.md"), "# Scope\n\n- Preserve owner policy.\n");
    runScopeFixtureGit(workspaceRoot, ["add", "AGENTS.md"]);
    runScopeFixtureGit(workspaceRoot, [
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
      workspaceRoot,
      scopeRoot: workspaceRoot,
      scopeId,
      stateDir: join(workspaceRoot, ".kota"),
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
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

  it("observes later guidance changes in a non-Git observe scope", () => {
    const workspaceRoot = trackDirectory("observe");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const policySnapshot = scopePolicySnapshotForTest(workspaceRoot, [{
      scopeId,
      reason: "Repository-free observe posture.",
      autonomy: { defaultMode: "passive", maxMode: "passive" },
      writes: { mode: "none" },
    }]);
    writeFileSync(join(workspaceRoot, "AGENTS.md"), "# Scope\n\n- Initial guidance.\n");
    const initial = computeScopeContentFingerprint(workspaceRoot, policySnapshot.policy);
    const consumed = {
      ...emptyScopeImprovementState(scopeId),
      lastRunAt: SCOPE_TEST_NOW.toISOString(),
      consumedFingerprint: initial.fingerprint,
    };
    writeFileSync(join(workspaceRoot, "AGENTS.md"), "# Scope\n\n- Revised guidance.\n");

    expect(inspectScopeSemanticBoundary({
      workspaceRoot,
      scopeRoot: workspaceRoot,
      scopeId,
      stateDir: join(workspaceRoot, ".kota"),
      scopePolicySnapshot: policySnapshot,
      state: consumed,
    })).toMatchObject({
      shouldEmit: true,
      payload: { boundary: "content-policy-changed", automatic: true },
      nextState: { pendingDelivery: "queued" },
    });
  });

  it("keeps explicit requests independent of the automatic fingerprint", () => {
    const workspaceRoot = track("explicit");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const fingerprint = computeScopeContentFingerprint(
      workspaceRoot,
      scopePolicySnapshotForTest(workspaceRoot).policy,
    );
    const state = {
      ...emptyScopeImprovementState(scopeId),
      consumedFingerprint: fingerprint.fingerprint,
    };
    const inputs = collectScopeImprovementInputs({
      workspaceRoot,
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
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
    });

    expect(inputs.alreadyConsumed).toBe(false);
    expect(inputs.triggerKind).toBe("explicit-request");
  });

  it("persists deferred automatic input and resumes it after cleanup", () => {
    const workspaceRoot = track("dirty-auto");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const fingerprint = computeScopeContentFingerprint(
      workspaceRoot,
      scopePolicySnapshotForTest(workspaceRoot).policy,
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
      workspaceRoot,
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
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
    });
    const deferred = deferScopeImprovementInput(pending, inputs);
    expect(deferred).toMatchObject({
      consumedFingerprint: null,
      pendingFingerprint: fingerprint.fingerprint,
      pendingDelivery: "deferred",
      pendingDeliveryAttempt: 1,
    });

    const resumed = inspectScopeSemanticBoundary({
      workspaceRoot,
      scopeRoot: workspaceRoot,
      scopeId: pending.scopeId,
      stateDir: join(workspaceRoot, ".kota"),
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
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

  it("keeps disabled input parked until the configuration fingerprint changes", () => {
    const workspaceRoot = track("disabled-auto");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const configDir = join(workspaceRoot, ".kota", "scope-improvement");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");
    writeFileSync(configPath, '{"enabled":false,"maxActionsPerRun":2}\n');
    const policySnapshot = scopePolicySnapshotForTest(workspaceRoot);
    const disabledFingerprint = computeScopeContentFingerprint(
      workspaceRoot,
      policySnapshot.policy,
    );
    const deferred = reserveScopeImprovementInput(
      emptyScopeImprovementState(scopeId),
      {
        fingerprint: disabledFingerprint.fingerprint,
        boundary: "initial-onboarding",
        delivery: "deferred",
        deliveryAttempt: 1,
      },
    );

    expect(inspectScopeSemanticBoundary({
      workspaceRoot,
      scopeRoot: workspaceRoot,
      scopeId,
      stateDir: join(workspaceRoot, ".kota"),
      scopePolicySnapshot: policySnapshot,
      state: deferred,
    })).toMatchObject({
      shouldEmit: false,
      reason: expect.stringContaining("scope improvement is disabled"),
    });

    writeFileSync(configPath, '{"enabled":true,"maxActionsPerRun":2}\n');
    expect(inspectScopeSemanticBoundary({
      workspaceRoot,
      scopeRoot: workspaceRoot,
      scopeId,
      stateDir: join(workspaceRoot, ".kota"),
      scopePolicySnapshot: policySnapshot,
      state: deferred,
    })).toMatchObject({
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
  });

  it("parks malformed configuration without admitting a semantic request", () => {
    const workspaceRoot = track("malformed-config");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const configDir = join(workspaceRoot, ".kota", "scope-improvement");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), '{"enabled":"false"}\n');

    expect(inspectScopeSemanticBoundary({
      workspaceRoot,
      scopeRoot: workspaceRoot,
      scopeId,
      stateDir: join(workspaceRoot, ".kota"),
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
      state: emptyScopeImprovementState(scopeId),
    })).toMatchObject({
      shouldEmit: false,
      reason: expect.stringContaining("authority cannot be inspected"),
      payload: null,
      nextState: null,
    });
  });
});
