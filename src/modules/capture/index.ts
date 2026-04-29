/**
 * Capture module — owns the unified cross-store capture seam.
 *
 * - Builds a `CaptureProviderImpl` and registers it as the `capture`
 *   provider.
 * - Wires each first-party store (memory, knowledge, tasks, inbox)
 *   as a typed contributor; adding a fifth store later means registering
 *   a fifth contributor here, not editing every consumer.
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
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import {
  getKnowledgeProvider,
  getMemoryProvider,
} from "#core/modules/provider-registry.js";
import type { CaptureClient } from "#core/server/kota-client.js";
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
import {
  createInboxContributor,
  createKnowledgeContributor,
  createMemoryContributor,
  createTasksContributor,
} from "./contributors.js";
import { captureApiRoutes, captureControlRoutes } from "./routes.js";
import {
  buildCaptureDynamicStateProvider,
  CAPTURE_DYNAMIC_STATE_NAME,
} from "./system-prompt.js";
import { createCaptureToolDef } from "./tool.js";

const CLASSIFIER_MAX_OUTPUT_TOKENS = 32;

let activeProvider: CaptureProvider | null = null;

function resolveActiveProvider(): CaptureProvider {
  if (!activeProvider) {
    throw new Error(
      "Capture provider is not initialized. Ensure the capture module loaded.",
    );
  }
  return activeProvider;
}

function createDefaultClassifier(ctx: ModuleContext): CaptureClassifier {
  return {
    async classify(input) {
      const config = loadConfig(ctx.cwd);
      let resolved: ReturnType<typeof createModelClient>;
      try {
        resolved = createModelClient({
          model: config.model || "claude-sonnet-4-6",
          ...(config.modelProvider?.type !== undefined && {
            provider: config.modelProvider.type,
          }),
          ...(config.modelProvider?.baseUrl !== undefined && {
            baseUrl: config.modelProvider.baseUrl,
          }),
          ...(config.modelProvider?.apiKey !== undefined && {
            apiKey: config.modelProvider.apiKey,
          }),
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
    "Cross-store capture seam — one natural-language note routed to memory, knowledge, tasks, or inbox through typed contributors.",
  dependencies: ["memory", "knowledge", "repo-tasks", "rendering"],

  onLoad(ctx: ModuleContext) {
    const provider = new CaptureProviderImpl({
      classifier: createDefaultClassifier(ctx),
    });
    provider.register(createMemoryContributor(getMemoryProvider()));
    provider.register(createKnowledgeContributor(getKnowledgeProvider()));
    provider.register(createTasksContributor(ctx.cwd));
    provider.register(createInboxContributor(ctx.cwd));
    activeProvider = provider;
    ctx.registerProvider(CAPTURE_PROVIDER_TOKEN, provider);
    ctx.registerProvider(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      createCaptureReadinessSource(provider),
    );
    ctx.registerDynamicStateProvider(
      CAPTURE_DYNAMIC_STATE_NAME,
      buildCaptureDynamicStateProvider(),
    );
    ctx.log.info(
      `capture: registered ${provider.contributors().length} contributor(s)`,
    );
  },

  commands: (ctx) => {
    const root = new Command("__root__");
    registerCaptureCommand(root, ctx);
    return root.commands as Command[];
  },

  tools: () => [createCaptureToolDef(resolveActiveProvider)],

  controlRoutes: () => captureControlRoutes(resolveActiveProvider),

  routes: () => captureApiRoutes(resolveActiveProvider),

  localClient: () => {
    const handler: CaptureClient = {
      async capture(text, filter) {
        return resolveActiveProvider().capture(text, filter);
      },
    };
    return { capture: handler };
  },

  onUnload() {
    activeProvider = null;
  },
};

export default captureModule;
