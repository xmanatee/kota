/**
 * Capture module — owns the unified cross-store capture seam.
 *
 * - Builds a `CaptureProviderImpl` and registers it as the `capture`
 *   provider.
 * - Maps each selected target to the canonical store operation and returns
 *   that store's domain result without a copied result envelope.
 * - Exposes the seam through one daemon-control route (`POST /capture`),
 *   one user-facing HTTP route (`POST /api/capture`), one
 *   `KotaClient.capture` namespace, and one `kota capture` CLI command.
 *
 * The classifier consults the project's configured model client. When
 * the model-clients module is not loaded or the model call throws, the
 * seam falls back to the ambiguous envelope rather than guessing.
 */

import { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import { createModelClient } from "#core/model/model-client.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import type { KotaModule, ModuleContext, ModuleRuntimeContext } from "#core/modules/module-types.js";
import { selectedScopeSelectorId } from "#core/server/scope-selector.js";
import { createCaptureReadinessSource } from "./capability-readiness.js";
import { CaptureProviderImpl } from "./capture-provider.js";
import {
  CAPTURE_PROVIDER_TOKEN,
  type CaptureClassifier,
  type CaptureProvider,
} from "./capture-types.js";
import {
  buildClassifierUserPrompt,
  CAPTURE_CLASSIFIER_SYSTEM_PROMPT,
  parseClassifierOutput,
} from "./classifier-prompt.js";
import { registerCaptureCommand } from "./cli.js";
import type {
  CaptureClient,
} from "./client.js";
import { captureApiRoutes, captureControlRoutes } from "./routes.js";
import { createCaptureScopeContextResolver } from "./scope-context.js";
import {
  buildCaptureDynamicStateProvider,
  CAPTURE_DYNAMIC_STATE_NAME,
} from "./system-prompt.js";
import { createCaptureToolDef } from "./tool.js";
import { captureUiSurfaceSource } from "./ui-surface.js";

const CLASSIFIER_MAX_OUTPUT_TOKENS = 32;

function requireCaptureProvider(ctx: ModuleContext): CaptureProvider {
  const provider = ctx.getProvider(CAPTURE_PROVIDER_TOKEN);
  if (!provider) throw new Error("capture provider is not registered");
  return provider;
}

function createDefaultClassifier(ctx: ModuleContext): CaptureClassifier {
  return {
    async classify(input) {
      const config = loadConfig(ctx.cwd);
      let resolved: ReturnType<typeof createModelClient>;
      try {
        resolved = createModelClient({
          model:
            config.model || resolveActivePresetFromConfig(config).defaultModel,
          ...(config.modelProvider?.type !== undefined && {
            provider: config.modelProvider.type,
          }),
          ...(config.modelProvider?.baseUrl !== undefined && {
            baseUrl: config.modelProvider.baseUrl,
          }),
          ...(config.modelProvider?.apiKey !== undefined && {
            apiKey: config.modelProvider.apiKey,
          }),
          scopeRoot: ctx.cwd,
        });
      } catch (err) {
        ctx.log.warn(
          `capture: classifier unavailable — ${err instanceof Error ? err.message : String(err)}`,
        );
        return { kind: "ambiguous" };
      }
      try {
        const userPrompt = buildClassifierUserPrompt(input);
        const response = await resolved.client.messages.create({
          model: resolved.model,
          max_tokens: CLASSIFIER_MAX_OUTPUT_TOKENS,
          system: CAPTURE_CLASSIFIER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        });
        const block = response.content.find((b) => b.type === "text");
        const raw = block && block.type === "text" ? block.text : "";
        return parseClassifierOutput(raw, input.available);
      } catch (err) {
        ctx.log.warn(
          `capture: classifier call failed — ${err instanceof Error ? err.message : String(err)}`,
        );
        return { kind: "ambiguous" };
      }
    },
  };
}

const captureModule: KotaModule = {
  name: "capture",
  version: "1.0.0",
  description:
    "Cross-store capture seam — one natural-language note routed to the canonical memory, knowledge, task, or inbox writer.",
  dependencies: ["memory", "knowledge", "repo-tasks", "rendering"],
  uiSurfaces: [captureUiSurfaceSource],

  onLoad(ctx: ModuleRuntimeContext) {
    const resolveScopeContext = createCaptureScopeContextResolver(ctx.cwd, ctx);
    const provider = new CaptureProviderImpl({
      classifier: createDefaultClassifier(ctx),
      resolveScopeContext,
    });
    ctx.registerProvider(CAPTURE_PROVIDER_TOKEN, provider);
    ctx.registerProvider(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      createCaptureReadinessSource(),
    );
    ctx.registerDynamicStateProvider(
      CAPTURE_DYNAMIC_STATE_NAME,
      buildCaptureDynamicStateProvider(),
    );
    ctx.log.info("capture: initialized cross-store writer");
  },

  commands: (ctx) => {
    const root = new Command("__root__");
    registerCaptureCommand(root, ctx);
    return root.commands as Command[];
  },

  tools: (ctx) => [createCaptureToolDef(() => requireCaptureProvider(ctx))],

  controlRoutes: (ctx) =>
    captureControlRoutes(
      () => requireCaptureProvider(ctx),
      createCaptureScopeContextResolver(ctx.cwd, ctx),
    ),

  routes: (ctx) =>
    captureApiRoutes(
      () => requireCaptureProvider(ctx),
      createCaptureScopeContextResolver(ctx.cwd, ctx),
    ),

  localClient: (ctx) => {
    const handler: CaptureClient = {
      async capture(text, filter) {
        const scope = createCaptureScopeContextResolver(ctx.cwd, ctx)(
          selectedScopeSelectorId(filter),
        );
        if ("error" in scope) throw new Error(`Unknown scope: ${scope.scopeId}`);
        return requireCaptureProvider(ctx).capture(text, filter, scope);
      },
    };
    return { capture: handler };
  },
};

export default captureModule;
