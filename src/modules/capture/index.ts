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
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import type { KotaModule, ModuleContext, ModuleRuntimeContext } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
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
  CaptureFilter,
  CaptureResult,
} from "./client.js";
import {
  createProjectInboxContributor,
  createProjectKnowledgeContributor,
  createProjectMemoryContributor,
  createProjectTasksContributor,
} from "./contributors.js";
import { createCaptureProjectContextResolver } from "./project-context.js";
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

/**
 * Daemon-side `CaptureClient` backed by the typed `DaemonTransport`. Calls the
 * same `/capture` HTTP route the daemon registers through
 * `captureControlRoutes(resolveActiveProvider)`. The transport surface owns the
 * bearer token, base URL, and timeout policy — this factory only encodes the
 * wire shape.
 *
 * The JSON body matches the prior `captureHttp` byte-for-byte: `{ text }` when
 * no filter is supplied, `{ text, filter }` when one is. The spread pattern
 * keeps `filter: undefined` from leaking onto the wire.
 */
function buildCaptureDaemonHandler(link: DaemonTransport): CaptureClient {
  return {
    capture: async (text: string, filter?: CaptureFilter): Promise<CaptureResult> =>
      link.requestStrict<CaptureResult>("POST", "/capture", {
        text,
        ...(filter && { filter }),
      }),
  };
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

  onLoad(ctx: ModuleRuntimeContext) {
    const resolveProjectContext = createCaptureProjectContextResolver(ctx.cwd);
    const provider = new CaptureProviderImpl({
      classifier: createDefaultClassifier(ctx),
      resolveProjectContext,
    });
    provider.register(createProjectMemoryContributor());
    provider.register(createProjectKnowledgeContributor());
    provider.register(createProjectTasksContributor());
    provider.register(createProjectInboxContributor());
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

  controlRoutes: (ctx) =>
    captureControlRoutes(
      resolveActiveProvider,
      createCaptureProjectContextResolver(ctx.cwd),
    ),

  routes: (ctx) =>
    captureApiRoutes(
      resolveActiveProvider,
      createCaptureProjectContextResolver(ctx.cwd),
    ),

  localClient: (ctx) => {
    const handler: CaptureClient = {
      async capture(text, filter) {
        const project = createCaptureProjectContextResolver(ctx.cwd)(
          filter?.projectId,
        );
        if ("error" in project) throw new Error(`Unknown project: ${project.projectId}`);
        return resolveActiveProvider().capture(text, filter, project);
      },
    };
    return { capture: handler };
  },

  daemonClient: (link) => ({ capture: buildCaptureDaemonHandler(link) }),

  onUnload() {
    activeProvider = null;
  },
};

export default captureModule;
