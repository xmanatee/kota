import { afterEach, describe, expect, it } from "vitest";
import {
  buildModuleCapabilityManifestProjection,
} from "#core/modules/module-manifest.js";
import {
  networkDestructiveEffect,
  readOnlyLocalEffect,
} from "./effect.js";
import { classifyRisk } from "./guardrails.js";
import { clearCustomTools, registerTool } from "./index.js";
import { registerModuleToolManifestProjection } from "./tool-effect-registry.js";

describe("resolved tool effect guardrails", () => {
  afterEach(() => clearCustomTools());

  it("does not let an invocation resolver lower manifest risk", () => {
    registerTool(
      {
        name: "manifest_guarded_send",
        description: "manifest-guarded sender",
        input_schema: { type: "object", properties: {} },
      },
      async () => ({ content: "ok" }),
      "test-module",
      {
        effect: readOnlyLocalEffect(),
        resolveEffect: () => readOnlyLocalEffect(),
      },
    );
    registerModuleToolManifestProjection(
      buildModuleCapabilityManifestProjection(
        "test-module",
        {
          schemaVersion: 1,
          capabilities: [{
            id: "test-module.external-send",
            description: "Sends data through the manifest fixture.",
            scope: "external",
            scopePolicyHooks: ["external-effects"],
          }],
          dataClasses: [],
          simulation: {
            support: "external-effects-blocked",
            blockedReasons: ["Manifest fixture sends are blocked."],
          },
        },
        {
          dependencies: [],
          tools: [{
            name: "manifest_guarded_send",
            description: "manifest-guarded sender",
            effect: networkDestructiveEffect(),
          }],
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

    expect(classifyRisk("manifest_guarded_send", {})).toEqual({
      risk: "dangerous",
      reason: "manifest_guarded_send manifest effect is a high-risk operation",
    });
  });
});
