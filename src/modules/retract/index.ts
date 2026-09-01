/**
 * Retract module — owns the unified cross-store retract seam, the
 * symmetric counterpart to capture.
 *
 * - Builds a `RetractProviderImpl` and registers it as the `retract`
 *   provider.
 * - Maps each selected target to the canonical store operation and returns
 *   that store's domain result without a copied result envelope.
 * - Exposes the seam through one daemon-control route (`POST /retract`),
 *   one user-facing HTTP route (`POST /api/retract`), one
 *   `KotaClient.retract` namespace, one `kota retract` CLI command, and
 *   one agent-callable `retract` tool with a `dangerous` risk
 *   classification.
 * - Registers a per-turn dynamic system-prompt contributor that emits a
 *   short conversational-pattern block when the session admits the
 *   `retract` tool, and the empty string otherwise.
 */

import { Command } from "commander";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import type { KotaModule, ModuleContext, ModuleRuntimeContext } from "#core/modules/module-types.js";
import { selectedScopeSelectorId } from "#core/server/scope-selector.js";
import { createRetractReadinessSource } from "./capability-readiness.js";
import { registerRetractCommand } from "./cli.js";
import type { RetractClient, } from "./client.js";
import { RetractProviderImpl } from "./retract-provider.js";
import {
  RETRACT_PROVIDER_TOKEN,
  type RetractProvider,
} from "./retract-types.js";
import { retractApiRoutes, retractControlRoutes } from "./routes.js";
import { createRetractScopeContextResolver } from "./scope-context.js";
import {
  buildRetractDynamicStateProvider,
  RETRACT_DYNAMIC_STATE_NAME,
} from "./system-prompt.js";
import { createRetractToolDef } from "./tool.js";
import { retractUiSurfaceSource } from "./ui-surface.js";

function requireRetractProvider(ctx: ModuleContext): RetractProvider {
  const provider = ctx.getProvider(RETRACT_PROVIDER_TOKEN);
  if (!provider) throw new Error("retract provider is not registered");
  return provider;
}

const retractModule: KotaModule = {
  name: "retract",
  version: "1.0.0",
  description:
    "Cross-store retract seam — typed removal of one prior capture through the canonical memory, knowledge, task, or inbox owner.",
  dependencies: ["memory", "knowledge", "repo-tasks", "rendering"],
  uiSurfaces: [retractUiSurfaceSource],
  manifest: {
    schemaVersion: 1,
    capabilities: [
      {
        id: "retract.cross-store",
        description: "Remove a named prior capture from memory, knowledge, tasks, or inbox stores.",
        scope: "scope",
        scopePolicyHooks: ["owner-confirmation", "writes", "retention"],
      },
      {
        id: "retract.operator-surface",
        description: "Expose retract through CLI, daemon-control, API, Telegram, Slack, web, mobile, and macOS clients.",
        scope: "scope",
        scopePolicyHooks: ["owner-confirmation", "channels"],
      },
    ],
    dataClasses: [
      {
        id: "retract.identifiers",
        description: "Typed ids, slugs, paths, and task ids naming the record to remove.",
        sensitivity: "internal",
        retention: "run-artifact",
        redaction: "metadata-only",
      },
      {
        id: "retract.removed-record-metadata",
        description: "Metadata describing the removed memory, knowledge, task, or inbox record.",
        sensitivity: "personal",
        retention: "run-artifact",
        redaction: "metadata-only",
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: [
        "Retract permanently removes or drops project records and is blocked in workflow trial mode.",
      ],
    },
  },

  onLoad(ctx: ModuleRuntimeContext) {
    const provider = new RetractProviderImpl({
      resolveScopeContext: createRetractScopeContextResolver(ctx.cwd, ctx),
    });
    ctx.registerProvider(RETRACT_PROVIDER_TOKEN, provider);
    ctx.registerProvider(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      createRetractReadinessSource(),
    );
    ctx.registerDynamicStateProvider(
      RETRACT_DYNAMIC_STATE_NAME,
      buildRetractDynamicStateProvider(),
    );
    ctx.log.info("retract: initialized cross-store remover");
  },

  commands: (ctx) => {
    const root = new Command("__root__");
    registerRetractCommand(root, ctx);
    return root.commands as Command[];
  },

  tools: (ctx) => [createRetractToolDef(() => requireRetractProvider(ctx))],

  controlRoutes: (ctx) =>
    retractControlRoutes(
      () => requireRetractProvider(ctx),
      createRetractScopeContextResolver(ctx.cwd, ctx),
    ),

  routes: (ctx) =>
    retractApiRoutes(
      () => requireRetractProvider(ctx),
      createRetractScopeContextResolver(ctx.cwd, ctx),
    ),

  localClient: (ctx) => {
    const handler: RetractClient = {
      async retract(request) {
        const scope = createRetractScopeContextResolver(ctx.cwd, ctx)(
          selectedScopeSelectorId(request),
        );
        if ("error" in scope) throw new Error(`Unknown scope: ${scope.scopeId}`);
        return requireRetractProvider(ctx).retract(request, scope);
      },
    };
    return { retract: handler };
  },
};

export default retractModule;
