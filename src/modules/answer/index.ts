/**
 * Answer module — owns the cited-answer seam on top of cross-store recall.
 *
 * - Wraps the recall provider with one synthesizer call per query.
 * - Persists every envelope through `AnswerHistoryStore` so operators
 *   can re-read past synthesized answers and the eval-harness has a
 *   real-failure corpus seeded from operator use.
 * - Exposes the seam through one daemon-control route (`POST /answer`),
 *   one user-facing HTTP route (`POST /api/answer`), one
 *   `KotaClient.answer` namespace (`answer`/`log`/`show`), and the CLI
 *   subcommands `kota answer <query>`, `kota answer log`, and
 *   `kota answer show <id>`. Surface fan-out (Telegram, macOS, mobile,
 *   web) lands as honest follow-ups, not in this module.
 */

import { join } from "node:path";
import { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import { createModelClient } from "#core/model/model-client.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import type {
  KotaModule,
  ModuleContext,
  ModuleRuntimeContext,
} from "#core/modules/module-types.js";
import {
  apiKeyNameForProvider,
  resolveApiKey,
  resolveModelProviderName,
} from "#modules/model-clients/factory.js";
import { RECALL_PROVIDER_TOKEN } from "#modules/recall/recall-types.js";
import { answerHistoryRootForScope, DiskAnswerHistoryStore } from "./answer-history-store.js";
import { AnswerProviderImpl } from "./answer-provider.js";
import {
  ANSWER_PROVIDER_TOKEN,
  type AnswerRecallSeam,
  type SynthesisInput,
  type Synthesizer,
} from "./answer-types.js";
import { createAnswerReadinessSource } from "./capability-readiness.js";
import { registerAnswerCommand } from "./cli.js";
import type { AnswerClient } from "./client.js";
import { createAnswerRecallContributor } from "./recall-contributor.js";
import { answerApiRoutes, answerControlRoutes } from "./routes.js";
import { createAnswerScopeContextResolver } from "./scope-context.js";
import {
  ANSWER_SYNTHESIS_SYSTEM_PROMPT,
  buildSynthesisUserPrompt,
} from "./synthesis-prompt.js";
import {
  ANSWER_DYNAMIC_STATE_NAME,
  buildAnswerDynamicStateProvider,
} from "./system-prompt.js";
import { createAnswerToolDef } from "./tool.js";
import { answerUiSurfaceSource } from "./ui-surface.js";

const ANSWER_MAX_OUTPUT_TOKENS = 1024;

function resolveProvider(ctx: ModuleContext): AnswerClient {
  const provider = ctx.getProvider(ANSWER_PROVIDER_TOKEN);
  if (!provider) {
    throw new Error(
      "Answer provider is not initialized. Ensure the answer module loaded.",
    );
  }
  return provider;
}

function createDefaultSynthesizer(ctx: ModuleContext): Synthesizer {
  return async (input: SynthesisInput) => {
    const config = loadConfig(ctx.cwd);
    const modelSpec =
      config.model || resolveActivePresetFromConfig(config).defaultModel;
    const resolved = createModelClient({
      model: modelSpec,
      provider: config.modelProvider?.type,
      baseUrl: config.modelProvider?.baseUrl,
      apiKey: config.modelProvider?.apiKey,
      scopeRoot: ctx.cwd,
    });
    const userPrompt = buildSynthesisUserPrompt(input);
    const response = await resolved.client.messages.create({
      model: resolved.model,
      max_tokens: ANSWER_MAX_OUTPUT_TOKENS,
      system: ANSWER_SYNTHESIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = response.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text : "";
  };
}

const answerModule: KotaModule = {
  name: "answer",
  version: "1.0.0",
  description:
    "Cited-answer seam — one query returns one short composed answer plus typed citations resolving back to the underlying RecallHits, with persisted history for re-read and eval-corpus seeding.",
  dependencies: ["recall", "model-clients", "rendering"],
  uiSurfaces: [answerUiSurfaceSource],

  onLoad(ctx: ModuleRuntimeContext) {
    const stateRoot = join(ctx.cwd, ".kota");
    const history = new DiskAnswerHistoryStore({
      rootDir: answerHistoryRootForScope(stateRoot),
    });
    const resolveScopeContext = createAnswerScopeContextResolver(
      ctx.cwd,
      () => history,
      ctx,
    );
    const recallSeam: AnswerRecallSeam = {
      async recall(query, filter) {
        return ctx.client.recall.recall(query, filter);
      },
    };
    const synthesizer = createDefaultSynthesizer(ctx);
    const provider = new AnswerProviderImpl({
      recall: recallSeam,
      synthesizer,
      history,
      resolveScopeContext,
      onSynthesisError: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log.warn(`answer: synthesis failed — ${msg}`);
      },
      onPersistError: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log.warn(`answer: history append failed — ${msg}`);
      },
    });
    ctx.registerProvider(ANSWER_PROVIDER_TOKEN, provider);
    ctx.registerProvider(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      createAnswerReadinessSource({
        hasModelClient: () => {
          const config = loadConfig(ctx.cwd);
          const modelSpec =
            config.model || resolveActivePresetFromConfig(config).defaultModel;
          const provider = resolveModelProviderName(
            modelSpec,
            config.modelProvider?.type,
          );
          if (!provider) return false;
          const requiredKeyName = apiKeyNameForProvider(provider);
          if (!requiredKeyName) return true;
          const explicit = config.modelProvider?.apiKey;
          const key = resolveApiKey(provider, explicit, { scopeRoot: ctx.cwd });
          return Boolean(key);
        },
      }),
    );
    ctx.registerDynamicStateProvider(
      ANSWER_DYNAMIC_STATE_NAME,
      buildAnswerDynamicStateProvider(),
    );

    // Contribute the answer-history corpus to the cross-store recall seam
    // through `RecallProvider`'s public registration API. The recall module
    // exposes its provider through the same typed-token seam every other
    // provider uses, and `recall` is declared in this module's
    // `dependencies`, so the loader has already populated the registry by
    // the time this `onLoad` runs.
    const recallProvider = ctx.getProvider(RECALL_PROVIDER_TOKEN);
    if (!recallProvider) {
      throw new Error(
        "answer module: `recall` provider is not registered. The recall module must load before answer (declared via dependencies).",
      );
    }
    recallProvider.register(
      createAnswerRecallContributor(history, resolveScopeContext),
    );
    ctx.log.info("answer: cited-answer seam ready");
    return {
      dispose: () => {
        recallProvider.unregister("answer");
      },
    };
  },

  commands: (ctx) => {
    const root = new Command("__root__");
    registerAnswerCommand(root, ctx);
    return root.commands as Command[];
  },

  tools: (ctx) => [createAnswerToolDef(() => resolveProvider(ctx))],

  controlRoutes: (ctx) =>
    answerControlRoutes(() => resolveProvider(ctx)),

  routes: (ctx) =>
    answerApiRoutes(() => resolveProvider(ctx)),

  localClient: (ctx) => {
    const handler: AnswerClient = {
      async answer(query, filter) {
        return resolveProvider(ctx).answer(query, filter);
      },
      async log(filter) {
        return resolveProvider(ctx).log(filter);
      },
      async show(id: string, scope) {
        return resolveProvider(ctx).show(id, scope);
      },
    };
    return { answer: handler };
  },
};

export default answerModule;
