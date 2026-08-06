import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ResolvedScopePolicy,
  resolveScopePolicy,
  type ScopePolicyFragment,
  type ScopePolicySnapshot,
} from "#core/daemon/scope-policy.js";
import {
  buildModuleCapabilityManifestProjection,
  clearModuleCapabilityManifestProjections,
  registerModuleCapabilityManifestProjection,
} from "#core/modules/module-manifest.js";
import {
  credentialInjectionEffect,
  localWriteEffect,
  networkReadEffect,
  networkWriteEffect,
  readOnlyLocalEffect,
  type ToolEffect,
} from "./effect.js";
import { deregisterTool, registerTool } from "./index.js";
import { executeToolCalls } from "./tool-runner.js";

const SCOPE_ID = "live-policy-fixture";
const PROJECT_DIR = "/tmp/kota-live-policy-fixture";
const registeredTools = new Set<string>();

afterEach(() => {
  for (const toolName of registeredTools) deregisterTool(toolName);
  registeredTools.clear();
  clearModuleCapabilityManifestProjections();
});

describe("hosted tool live scope policy", () => {
  it("revokes writes at the next invocation without executing the tool again", async () => {
    await expectLiveRestriction({
      toolName: "live_policy_write",
      effect: localWriteEffect(),
      input: { path: `${PROJECT_DIR}/output.txt` },
      restriction: { writes: { mode: "none" } },
      expectedDenial: "writes are disabled",
    });
  });

  it("revokes a module at the same live authorization boundary", async () => {
    const toolName = "live_policy_module_read";
    registerManifestTool(toolName, readOnlyLocalEffect());
    await expectLiveRestriction({
      toolName,
      effect: readOnlyLocalEffect(),
      input: {},
      restriction: {
        modules: {
          overrides: [{ moduleName: "live-policy-module", availability: "disabled" }],
        },
      },
      expectedDenial: "module live-policy-module is disabled",
    });
  });

  it("revokes network access at the same live authorization boundary", async () => {
    await expectLiveRestriction({
      toolName: "live_policy_network_read",
      effect: networkReadEffect(),
      input: {},
      restriction: { externalEffects: { networkRead: "deny" } },
      expectedDenial: "read on external-network",
    });
  });

  it.each([
    ["process-environment", credentialInjectionEffect()],
    ["external-network", networkWriteEffect()],
  ] as const)("revokes %s writes through external owner policy", async (_surface, effect) => {
    await expectLiveRestriction({
      toolName: `live_policy_external_write_${effect.scope}`,
      effect,
      input: {},
      restriction: { ownerConfirmation: { externalWrite: "deny" } },
      expectedDenial: `${effect.scope} -> deny`,
    });
  });

  it("applies a live autonomy cap before the next invocation", async () => {
    await expectLiveRestriction({
      toolName: "live_policy_session_write",
      effect: localWriteEffect(),
      input: { path: `${PROJECT_DIR}/session-output.txt` },
      restriction: {
        autonomy: { defaultMode: "passive", maxMode: "passive" },
      },
      expectedDenial: 'autonomy mode "passive"',
    });
  });
});

async function expectLiveRestriction(args: {
  toolName: string;
  effect: ToolEffect;
  input: Record<string, unknown>;
  restriction: Omit<ScopePolicyFragment, "scopeId" | "reason">;
  expectedDenial: string;
}): Promise<void> {
  const runner = vi.fn(async () => ({ content: "executed" }));
  registerTool(
    {
      name: args.toolName,
      description: "live scope-policy fixture",
      input_schema: { type: "object", properties: {}, additionalProperties: true },
    },
    runner,
    "live-policy-module",
    { effect: args.effect },
  );
  registeredTools.add(args.toolName);

  const initialPolicy = policyFor();
  let snapshot: ScopePolicySnapshot = { revision: 0, policy: initialPolicy };
  const getScopePolicySnapshot = vi.fn(() => snapshot);
  const options = {
    resultLimit: 50_000,
    verbose: false,
    autonomyMode: "autonomous" as const,
    scopePolicy: initialPolicy,
    getScopePolicySnapshot,
    cwd: PROJECT_DIR,
  };

  const [allowed] = await executeToolCalls(
    [{ type: "tool_use", id: "before", name: args.toolName, input: args.input }],
    options,
  );
  snapshot = { revision: 1, policy: policyFor(args.restriction) };
  const [denied] = await executeToolCalls(
    [{ type: "tool_use", id: "after", name: args.toolName, input: args.input }],
    options,
  );

  expect(allowed).toMatchObject({ content: "executed" });
  expect(allowed?.is_error).not.toBe(true);
  expect(denied).toMatchObject({ is_error: true });
  expect(denied?.content).toContain(args.expectedDenial);
  expect(runner).toHaveBeenCalledTimes(1);
  expect(getScopePolicySnapshot).toHaveBeenCalledTimes(2);
}

function policyFor(
  restriction: Omit<ScopePolicyFragment, "scopeId" | "reason"> = {},
): ResolvedScopePolicy {
  return resolveScopePolicy({
    projection: {
      rootScopeId: "global",
      defaultScopeId: SCOPE_ID,
      scopes: [
        { scopeId: "global", displayName: "Global" },
        {
          scopeId: SCOPE_ID,
          displayName: "Live policy fixture",
          parentScopeId: "global",
          directoryRoot: PROJECT_DIR,
        },
      ],
    },
    scopeId: SCOPE_ID,
    fragments: [
      {
        scopeId: "global",
        reason: "Live tool execution starts without owner or network write restrictions.",
        ownerConfirmation: { externalWrite: "allow" },
        externalEffects: { networkWrite: "allow" },
      },
      { scopeId: SCOPE_ID, reason: "Live restriction fixture.", ...restriction },
    ],
  });
}

function registerManifestTool(toolName: string, effect: ToolEffect): void {
  registerModuleCapabilityManifestProjection(
    buildModuleCapabilityManifestProjection(
      "live-policy-module",
      {
        schemaVersion: 1,
        capabilities: [{
          id: "live-policy-module.read",
          description: "Reads a live-policy fixture.",
          scope: "project",
          scopePolicyHooks: ["writes"],
        }],
        dataClasses: [],
        simulation: { support: "full", blockedReasons: [] },
      },
      {
        dependencies: [],
        tools: [{ name: toolName, description: "fixture", effect }],
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
