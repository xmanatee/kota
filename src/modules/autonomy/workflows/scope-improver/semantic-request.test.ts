import { rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { readScopeImprovementState } from "./scope-improvement-state.js";
import { scopePolicySnapshotForTest } from "./scope-policy-test-support.js";
import {
  handleRegisteredScopeImprovementOnboarding,
  scopeImprovementDispatchKey,
} from "./semantic-request.js";
import { makeScopeFixture } from "./workflow.test-helpers.js";

describe("scope improvement onboarding activation", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("turns one live scope registration into one initial semantic request", () => {
    const projectDir = makeScopeFixture("production-onboarding");
    projectDirs.push(projectDir);
    const scopeId = deriveDirectoryScopeId(projectDir);
    const snapshot = scopePolicySnapshotForTest(projectDir);
    const emit = vi.fn();
    const warn = vi.fn();
    const ctx = {
      getProvider: () => ({
        resolveProjectRuntime: () => ({
          ok: true as const,
          runtime: {
            project: {
              projectId: scopeId,
              projectDir,
              displayName: "External scope",
            },
            scopePolicyAuthority: { getSnapshot: () => snapshot },
          },
        }),
      }),
      events: { emit },
      log: {
        info: vi.fn(),
        warn,
        error: vi.fn(),
        debug: vi.fn(),
      },
    } as unknown as Parameters<
      typeof handleRegisteredScopeImprovementOnboarding
    >[0];
    const lifecycle = {
      transition: "registered" as const,
      affectedScopeId: scopeId,
      directoryRoot: projectDir,
      displayName: "External scope",
    };

    handleRegisteredScopeImprovementOnboarding(ctx, lifecycle);
    handleRegisteredScopeImprovementOnboarding(ctx, lifecycle);

    expect(emit).toHaveBeenCalledTimes(1);
    const payload = emit.mock.calls[0]?.[1];
    expect(payload).toMatchObject({
      automatic: true,
      boundary: "initial-onboarding",
      deliveryAttempt: 0,
      scopeId,
      projectId: scopeId,
    });
    expect(payload.idempotencyKey).toBe(
      scopeImprovementDispatchKey(scopeId, payload.fingerprint, 0),
    );
    expect(readScopeImprovementState(projectDir, scopeId)).toMatchObject({
      consumedFingerprint: null,
      pendingFingerprint: payload.fingerprint,
      pendingBoundary: "initial-onboarding",
      pendingDelivery: "queued",
      pendingDeliveryAttempt: 0,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
