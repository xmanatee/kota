import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { resolveScopeImprovementAuthority } from "./scope-improvement-authority.js";
import { scopePolicySnapshotForTest } from "./scope-policy-test-support.js";

describe("scope improvement authority", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function createScope(label: string): string {
    const root = mkdtempSync(join(tmpdir(), `kota-scope-authority-${label}-`));
    roots.push(root);
    mkdirSync(join(root, ".kota", "scope-improvement"), { recursive: true });
    return root;
  }

  it("rejects malformed explicit configuration instead of applying enabled defaults", () => {
    const scopeRoot = createScope("malformed-config");
    writeFileSync(
      join(scopeRoot, ".kota", "scope-improvement", "config.json"),
      '{"enabled":"false"}\n',
    );

    expect(() => resolveScopeImprovementAuthority({
      scopeRoot,
      stateDir: join(scopeRoot, ".kota"),
      policy: scopePolicySnapshotForTest(scopeRoot).policy,
    })).toThrow("scope improvement config enabled must be a boolean");
  });

  it("enables builder authority when a bounded policy exposes writable roots", () => {
    const scopeRoot = createScope("bounded-builder");
    const scopeId = deriveDirectoryScopeId(scopeRoot);
    const policy = scopePolicySnapshotForTest(scopeRoot, [{
      scopeId,
      reason: "Autonomous builds may update source and their task contract.",
      autonomy: { defaultMode: "autonomous", maxMode: "autonomous" },
      writes: { mode: "paths", paths: ["src", "data/tasks"] },
    }]).policy;

    expect(resolveScopeImprovementAuthority({
      scopeRoot,
      stateDir: join(scopeRoot, ".kota"),
      policy,
    })).toMatchObject({
      posture: "build",
      builder: "enabled",
      taskProposalDecision: { outcome: "allow" },
      builderDecision: { outcome: "allow" },
    });
  });

  it("resolves confirmation-required task writes to owner questions", () => {
    const scopeRoot = createScope("confirmation-required");
    const scopeId = deriveDirectoryScopeId(scopeRoot);
    const policy = scopePolicySnapshotForTest(scopeRoot, [{
      scopeId,
      reason: "Automated task writes require an owner decision.",
      autonomy: { defaultMode: "autonomous", maxMode: "autonomous" },
      writes: { mode: "scope-directory" },
      ownerConfirmation: { localWrite: "confirm" },
    }]).policy;

    expect(resolveScopeImprovementAuthority({
      scopeRoot,
      stateDir: join(scopeRoot, ".kota"),
      policy,
    })).toMatchObject({
      configuredPosture: "build",
      posture: "observe",
      review: "owner-questions",
      builder: "disabled",
      taskProposalDecision: { outcome: "confirm" },
      builderDecision: { outcome: "confirm" },
    });
  });
});
