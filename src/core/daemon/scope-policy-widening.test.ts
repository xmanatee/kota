import { describe, expect, it } from "vitest";
import {
  resolveScopePolicy,
  type ScopePolicyArea,
  type ScopePolicyFragment,
} from "./scope-policy.js";
import {
  scopePolicyRestrictiveAreas,
  scopePolicyWideningAreas,
} from "./scope-policy-widening.js";
import type { ScopeRegistryProjection } from "./scope-registry.js";

const PROJECTION: ScopeRegistryProjection = {
  rootScopeId: "global",
  defaultScopeId: "workspace",
  scopes: [
    { scopeId: "global", displayName: "Global" },
    {
      scopeId: "workspace",
      displayName: "Workspace",
      parentScopeId: "global",
      directoryRoot: "/tmp/workspace",
    },
  ],
};

type RestrictionFixture = Omit<ScopePolicyFragment, "scopeId" | "reason">;

const RESTRICTIONS = Object.entries({
  autonomy: { autonomy: { defaultMode: "passive", maxMode: "passive" } },
  writes: { writes: { mode: "none" } },
  channels: { channels: { mode: "blocked" } },
  setup: { setup: { visibility: "hidden" } },
  ownerConfirmation: { ownerConfirmation: { localWrite: "deny" } },
  retention: {
    retention: { mode: "expire-after-days", maxAgeDays: 1, redaction: "full" },
  },
  modules: { modules: { defaultAvailability: "disabled" } },
  externalEffects: { externalEffects: { networkRead: "deny" } },
} satisfies Readonly<Record<ScopePolicyArea, RestrictionFixture>>) as Array<
  [ScopePolicyArea, RestrictionFixture]
>;

describe("scope policy change classification", () => {
  it.each(RESTRICTIONS)("classifies a %s capability reduction as restrictive", (area, fragment) => {
    const current = policy();
    const next = policy(fragment);

    expect(scopePolicyRestrictiveAreas(current, next)).toEqual([area]);
    expect(scopePolicyWideningAreas(current, next)).toEqual([]);
  });

  it("distinguishes equal and purely permissive changes from restrictions", () => {
    const restricted = policy({
      writes: { mode: "none" },
      externalEffects: { networkRead: "deny" },
    });
    const equal = policy({
      writes: { mode: "none" },
      externalEffects: { networkRead: "deny" },
    });
    const permissive = policy();

    expect(scopePolicyRestrictiveAreas(restricted, equal)).toEqual([]);
    expect(scopePolicyRestrictiveAreas(restricted, permissive)).toEqual([]);
    expect(scopePolicyWideningAreas(restricted, permissive)).toEqual([
      "writes",
      "externalEffects",
    ]);
  });

  it("classifies module override removal against the effective default", () => {
    const defaultDisabled = policy({
      modules: {
        defaultAvailability: "disabled",
        overrides: [{ moduleName: "git", availability: "enabled" }],
      },
    });
    const removedOverride = policy({
      modules: { defaultAvailability: "disabled", overrides: [] },
    });

    expect(scopePolicyRestrictiveAreas(defaultDisabled, removedOverride)).toEqual(["modules"]);
    expect(scopePolicyWideningAreas(removedOverride, defaultDisabled)).toEqual(["modules"]);
  });
});

function policy(
  fragment: Omit<ScopePolicyFragment, "scopeId" | "reason"> = {},
) {
  return resolveScopePolicy({
    projection: PROJECTION,
    scopeId: "workspace",
    fragments: [{ scopeId: "workspace", reason: "Focused policy fixture.", ...fragment }],
  });
}
