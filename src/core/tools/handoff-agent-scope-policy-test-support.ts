import { join } from "node:path";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import {
  type ResolvedScopePolicy,
  resolveScopePolicy,
  type ScopePolicyAuthority,
  type ScopePolicyFragment,
} from "#core/daemon/scope-policy.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import {
  buildModuleCapabilityManifestProjection,
  registerModuleCapabilityManifestProjection,
} from "#core/modules/module-manifest.js";
import type { ToolEffect } from "./effect.js";
import { registerTool, type ToolRunner } from "./index.js";

export {
  initGitTestProject as initHandoffPolicyGitProject,
} from "#core/util/git-project-test-support.js";

export const HANDOFF_POLICY_HARNESS = "handoff-hosted-scope-policy";
export const HANDOFF_POLICY_MODULE = "handoff-policy-fixture";

export function handoffScopePolicy(
  projectDir: string,
  restriction: Omit<ScopePolicyFragment, "scopeId" | "reason"> = {},
): ResolvedScopePolicy {
  const scopeId = deriveDirectoryScopeId(projectDir);
  return resolveScopePolicy({
    projection: {
      rootScopeId: "global",
      defaultScopeId: scopeId,
      scopes: [
        { scopeId: "global", displayName: "Global" },
        {
          scopeId,
          displayName: "Fixture",
          parentScopeId: "global",
          directoryRoot: projectDir,
        },
      ],
    },
    scopeId,
    fragments: [{
      scopeId,
      reason: "Handoff child policy fixture.",
      ...restriction,
    }],
  });
}

export function handoffScopePolicyAuthority(
  policy: ResolvedScopePolicy,
): ScopePolicyAuthority {
  return {
    getSnapshot: () => ({ revision: 0, policy }),
    subscribeRestrictiveChanges: () => () => {},
  };
}

export function handoffApprovalQueue(
  projectDir: string,
  scopeId: string,
  bus: EventBus = new EventBus(),
): ApprovalQueue {
  return new ApprovalQueue(
    join(projectDir, ".kota", "approvals"),
    new ProjectScopedEventBus(bus, scopeId),
    { scopeId },
  );
}

export function registerHandoffPolicyTool(
  name: string,
  effect: ToolEffect,
  runner: ToolRunner,
): void {
  registerTool(
    {
      name,
      description: `Handoff policy fixture ${name}`,
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
        additionalProperties: false,
      },
    },
    runner,
    HANDOFF_POLICY_MODULE,
    { effect },
  );
}

export function registerHandoffPolicyManifest(
  name: string,
  effect: ToolEffect,
): void {
  registerModuleCapabilityManifestProjection(
    buildModuleCapabilityManifestProjection(
      HANDOFF_POLICY_MODULE,
      {
        schemaVersion: 1,
        capabilities: [{
          id: `${HANDOFF_POLICY_MODULE}.tool`,
          description: "Tool used to prove module-policy inheritance.",
          scope: "project",
          scopePolicyHooks: ["writes"],
        }],
        dataClasses: [],
        simulation: { support: "full", blockedReasons: [] },
      },
      {
        dependencies: [],
        tools: [{ name, description: "module fixture", effect }],
        effects: [],
        workflows: [],
        workflowTriggers: [],
        channels: [],
        skills: [],
        agents: [],
        commands: [],
        routes: [],
        controlRoutes: [],
        events: [],
        eventFlows: [],
        localClientNamespaces: [],
        hasDaemonClientFactory: false,
        setupRequirements: [],
        hasHealthCheck: false,
      },
    ),
  );
}
