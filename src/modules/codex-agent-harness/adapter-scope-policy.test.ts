import { describe, expect, it } from "vitest";
import { projectNativeCliScope } from "#core/agent-harness/native-cli-scope-policy.js";
import { resolveScopePolicy, type ScopePolicyFragment } from "#core/daemon/scope-policy.js";
import type { ScopeRegistryProjection } from "#core/daemon/scope-registry.js";
import { codexAgentHarness } from "./adapter.js";

const PROJECTION: ScopeRegistryProjection = {
  rootScopeId: "global",
  defaultScopeId: "project",
  scopes: [
    { scopeId: "global", displayName: "Global" },
    {
      scopeId: "project",
      displayName: "Project",
      parentScopeId: "global",
      directoryRoot: "/canonical/project",
    },
  ],
};

function policy(fragment?: ScopePolicyFragment) {
  return resolveScopePolicy({
    projection: PROJECTION,
    scopeId: "project",
    ...(fragment === undefined ? {} : { fragments: [fragment] }),
  });
}

describe("Codex agent harness scope policy boundary", () => {
  it("honors scope policy through the native sandbox", () => {
    expect(
      codexAgentHarness.unsupportedRunOptions?.map((option) => option.option),
    ).not.toContain("scopePolicy");
  });

  it("projects policy paths into the run worktree", () => {
    expect(projectNativeCliScope({
      cwd: "/worktrees/run",
      autonomyMode: "autonomous",
      scopePolicy: policy({
        scopeId: "project",
        reason: "Limit writes to implementation and generated evidence.",
        writes: { mode: "paths", paths: ["src", "data/generated"] },
      }),
    })).toEqual({
      executionMode: "bounded-edits",
      writableRoots: [
        "/worktrees/run/src",
        "/worktrees/run/data/generated",
      ],
    });
  });

  it("denies native writes when either runtime or owner policy is read-only", () => {
    const writablePolicy = policy();
    expect(projectNativeCliScope({
      cwd: "/worktrees/run",
      autonomyMode: "passive",
      scopePolicy: writablePolicy,
    })).toEqual({ executionMode: "plan", writableRoots: [] });
    expect(projectNativeCliScope({
      cwd: "/worktrees/run",
      autonomyMode: "autonomous",
      scopePolicy: policy({
        scopeId: "project",
        reason: "Require owner confirmation before local writes.",
        ownerConfirmation: { localWrite: "confirm" },
      }),
    })).toEqual({ executionMode: "plan", writableRoots: [] });
  });

  it("keeps native tools offline and module-free while preserving bounded edits", () => {
    expect(projectNativeCliScope({
      cwd: "/worktrees/run",
      autonomyMode: "autonomous",
      scopePolicy: policy({
        scopeId: "project",
        reason: "No external or KOTA module effects.",
        modules: { defaultAvailability: "disabled" },
        externalEffects: {
          networkRead: "deny",
          networkWrite: "deny",
          networkDestructive: "deny",
        },
      }),
    })).toEqual({
      executionMode: "bounded-edits",
      writableRoots: ["/worktrees/run"],
    });
  });

  it("uses plan mode when local destructive effects are denied", () => {
    expect(projectNativeCliScope({
      cwd: "/worktrees/run",
      autonomyMode: "autonomous",
      scopePolicy: policy({
        scopeId: "project",
        reason: "No destructive local effects.",
        ownerConfirmation: { destructive: "deny" },
      }),
    })).toEqual({ executionMode: "plan", writableRoots: [] });
  });

  it("rejects policy paths that cannot be projected into the run worktree", () => {
    expect(() => projectNativeCliScope({
      cwd: "/worktrees/run",
      autonomyMode: "autonomous",
      scopePolicy: policy({
        scopeId: "project",
        reason: "External path fixture.",
        writes: { mode: "paths", paths: ["/operator/outside"] },
      }),
    })).toThrow(/outside scope directory/);
  });
});
