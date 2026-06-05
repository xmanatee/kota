import { describe, expect, it } from "vitest";
import {
  decideScopePolicy,
  resolveScopePolicy,
  type ScopePolicyFragment,
  ScopePolicyValidationError,
} from "./scope-policy.js";
import type { ScopeRegistryProjection } from "./scope-registry.js";

const PROJECTION: ScopeRegistryProjection = {
  rootScopeId: "global",
  defaultScopeId: "workspace",
  scopes: [
    { scopeId: "global", displayName: "Global" },
    { scopeId: "workspace", displayName: "Workspace", parentScopeId: "global", directoryRoot: "/tmp/workspace" },
    { scopeId: "feature", displayName: "Feature", parentScopeId: "workspace", directoryRoot: "/tmp/workspace/feature" },
  ],
};

describe("scope policy inheritance", () => {
  it("inherits the explicit root migration policy when a child has no policy fragment", () => {
    const policy = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "feature",
    });

    expect(policy.lineage).toEqual(["global", "workspace", "feature"]);
    expect(policy.autonomy.defaultMode).toBe("autonomous");
    expect(policy.channels.mode).toBe("allow-all");
    expect(policy.channels.source.scopeId).toBe("global");
    expect(policy.explanations.some((entry) => entry.action === "inherit")).toBe(true);
  });

  it("applies restrictive child overrides and preserves their explanation source", () => {
    const policy = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
      fragments: [
        {
          scopeId: "workspace",
          reason: "Workspace only allows operator chat ingress.",
          autonomy: { defaultMode: "supervised" },
          writes: { mode: "scope-directory" },
          channels: {
            mode: "allow-list",
            allowedChannels: ["telegram"],
            blockedSources: ["fixture-blocked-chat"],
            ignoredSources: ["fixture-muted-chat"],
          },
          setup: { visibility: "metadata" },
          ownerConfirmation: { localWrite: "confirm" },
          modules: {
            defaultAvailability: "setup-required",
            overrides: [{ moduleName: "telegram", availability: "enabled" }],
          },
          externalEffects: { networkRead: "confirm" },
        },
      ],
    });

    expect(policy.autonomy.defaultMode).toBe("supervised");
    expect(policy.writes.mode).toBe("scope-directory");
    expect(policy.channels.allowedChannels).toEqual(["telegram"]);
    expect(policy.setup.visibility).toBe("metadata");
    expect(policy.ownerConfirmation.localWrite).toBe("confirm");
    expect(policy.modules.defaultAvailability).toBe("setup-required");
    expect(policy.modules.overrides).toEqual([{ moduleName: "telegram", availability: "enabled" }]);
    expect(policy.externalEffects.networkRead).toBe("confirm");
    expect(policy.channels.source.scopeId).toBe("workspace");
  });

  it("rejects child widening unless the parent explicitly permits the area", () => {
    const fragments: ScopePolicyFragment[] = [
      {
        scopeId: "workspace",
        reason: "Only Telegram is eligible.",
        channels: { mode: "allow-list", allowedChannels: ["telegram"] },
      },
      {
        scopeId: "feature",
        reason: "Attempts to re-open all channels.",
        channels: { mode: "allow-all" },
      },
    ];

    expect(() =>
      resolveScopePolicy({ projection: PROJECTION, scopeId: "feature", fragments }),
    ).toThrow(ScopePolicyValidationError);

    const permitted = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "feature",
      fragments: [
        { ...fragments[0]!, allowChildWidening: ["channels"] },
        fragments[1]!,
      ],
    });
    expect(permitted.channels.mode).toBe("allow-all");
  });

  it("rejects child write path widening unless the parent explicitly permits writes", () => {
    const fragments: ScopePolicyFragment[] = [
      {
        scopeId: "workspace",
        reason: "Writes are limited to the safe subtree.",
        writes: { mode: "paths", paths: ["safe"] },
      },
      {
        scopeId: "feature",
        reason: "Attempts to open the filesystem root.",
        writes: { mode: "paths", paths: ["/"] },
      },
    ];

    expect(() =>
      resolveScopePolicy({ projection: PROJECTION, scopeId: "feature", fragments }),
    ).toThrow(ScopePolicyValidationError);

    const narrowed = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "feature",
      fragments: [
        fragments[0]!,
        {
          scopeId: "feature",
          reason: "Narrows to generated files under the safe subtree.",
          writes: { mode: "paths", paths: ["safe/generated"] },
        },
      ],
    });
    expect(narrowed.writes).toMatchObject({ mode: "paths", paths: ["safe/generated"] });

    const permitted = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "feature",
      fragments: [
        { ...fragments[0]!, allowChildWidening: ["writes"] },
        fragments[1]!,
      ],
    });
    expect(permitted.writes).toMatchObject({ mode: "paths", paths: ["/"] });
  });

  it("explains channel routing decisions from inherited policy", () => {
    const policy = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
      fragments: [
        {
          scopeId: "workspace",
          reason: "Block noisy Telegram sources.",
          channels: {
            mode: "allow-list",
            allowedChannels: ["telegram"],
            blockedSources: ["fixture-blocked-chat"],
          },
        },
      ],
    });

    const blocked = decideScopePolicy(policy, {
      kind: "channel-route",
      channel: "telegram",
      source: "fixture-blocked-chat",
    });
    const allowed = decideScopePolicy(policy, {
      kind: "channel-route",
      channel: "telegram",
      source: "operator-chat",
    });

    expect(blocked.outcome).toBe("deny");
    expect(blocked.rendered).toContain("fixture-blocked-chat is blocked");
    expect(allowed.outcome).toBe("allow");
  });

  it("resolves owner confirmation and retention for tool effects", () => {
    const policy = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
      fragments: [
        {
          scopeId: "workspace",
          reason: "Local writes need owner review and artifacts expire.",
          ownerConfirmation: { localWrite: "confirm" },
          retention: { mode: "expire-after-days", maxAgeDays: 30, redaction: "full" },
        },
      ],
    });

    const decision = decideScopePolicy(policy, {
      kind: "tool-effect",
      toolName: "edit_file",
      effectKind: "write",
      effectScope: "local-fs",
      targetPath: "/tmp/workspace/notes.md",
    });

    expect(decision.outcome).toBe("confirm");
    expect(policy.retention).toMatchObject({
      mode: "expire-after-days",
      maxAgeDays: 30,
      redaction: "full",
    });
    expect(policy.retention.source.scopeId).toBe("workspace");
  });

  it("enforces local write boundaries before owner-confirmation policy", () => {
    const noWrites = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
      fragments: [
        {
          scopeId: "workspace",
          reason: "This scope is read-only.",
          writes: { mode: "none" },
          ownerConfirmation: { localWrite: "allow" },
        },
      ],
    });

    const readOnlyDecision = decideScopePolicy(noWrites, {
      kind: "tool-effect",
      toolName: "edit_file",
      effectKind: "write",
      effectScope: "local-fs",
      targetPath: "/tmp/workspace/notes.md",
    });

    expect(readOnlyDecision.outcome).toBe("deny");
    expect(readOnlyDecision.source.scopeId).toBe("workspace");
    expect(readOnlyDecision.reason).toContain("writes are disabled");

    const scopedWrites = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
      fragments: [
        {
          scopeId: "workspace",
          reason: "Writes stay in the workspace.",
          writes: { mode: "scope-directory" },
          ownerConfirmation: { localWrite: "allow" },
        },
      ],
    });

    const outsideDirectory = decideScopePolicy(scopedWrites, {
      kind: "tool-effect",
      toolName: "edit_file",
      effectKind: "write",
      effectScope: "local-fs",
      targetPath: "/tmp/elsewhere/notes.md",
    });

    expect(outsideDirectory.outcome).toBe("deny");
    expect(outsideDirectory.reason).toContain("outside the scope directory");

    const allowedPathWrites = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
      fragments: [
        {
          scopeId: "workspace",
          reason: "Only generated files are writable.",
          writes: { mode: "paths", paths: ["generated"] },
          ownerConfirmation: { localWrite: "confirm" },
        },
      ],
    });

    const allowedPath = decideScopePolicy(allowedPathWrites, {
      kind: "tool-effect",
      toolName: "edit_file",
      effectKind: "write",
      effectScope: "local-fs",
      targetPath: "/tmp/workspace/generated/result.md",
    });
    const blockedPath = decideScopePolicy(allowedPathWrites, {
      kind: "tool-effect",
      toolName: "edit_file",
      effectKind: "write",
      effectScope: "local-fs",
      targetPath: "/tmp/workspace/source/result.md",
    });

    expect(allowedPath.outcome).toBe("confirm");
    expect(allowedPath.reason).toContain("inside an allowed write path");
    expect(blockedPath.outcome).toBe("deny");
    expect(blockedPath.reason).toContain("outside the allowed write paths");
  });
});
