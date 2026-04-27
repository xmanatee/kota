/**
 * Answer module — owns the cited-answer seam on top of cross-store recall.
 *
 * - Wraps the recall provider with one synthesizer call per query.
 * - Exposes the seam through one daemon-control route (`POST /answer`),
 *   one user-facing HTTP route (`POST /api/answer`), one
 *   `KotaClient.answer` namespace, and one `kota answer <query>` CLI
 *   subcommand. Surface fan-out (Telegram, macOS, mobile, web) lands as
 *   honest follow-ups, not in this module.
 */

import { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import { createModelClient } from "#core/model/model-client.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { AnswerClient } from "#core/server/kota-client.js";
import { AnswerProviderImpl } from "./answer-provider.js";
import type {
  AnswerProvider,
  AnswerRecallSeam,
  SynthesisInput,
  Synthesizer,
} from "./answer-types.js";
import { registerAnswerCommand } from "./cli.js";
import { answerApiRoutes, answerControlRoutes } from "./routes.js";
import {
  ANSWER_SYNTHESIS_SYSTEM_PROMPT,
  buildSynthesisUserPrompt,
} from "./synthesis-prompt.js";

const ANSWER_MAX_OUTPUT_TOKENS = 1024;

let activeProvider: AnswerProvider | null = null;

function resolveActiveProvider(): AnswerProvider {
  if (!activeProvider) {
    throw new Error(
      "Answer provider is not initialized. Ensure the answer module loaded.",
    );
  }
  return activeProvider;
}

function createDefaultSynthesizer(ctx: ModuleContext): Synthesizer {
  return async (input: SynthesisInput) => {
    const config = loadConfig(ctx.cwd);
    const modelSpec = config.model || "claude-sonnet-4-6";
    const resolved = createModelClient({
      model: modelSpec,
      provider: config.modelProvider?.type,
      baseUrl: config.modelProvider?.baseUrl,
      apiKey: config.modelProvider?.apiKey,
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
    "Cited-answer seam — one query returns one short composed answer plus typed citations resolving back to the underlying RecallHits.",
  dependencies: ["recall", "model-clients", "rendering"],

  onLoad(ctx: ModuleContext) {
    const recallSeam: AnswerRecallSeam = {
      async recall(query, filter) {
        return ctx.client.recall.recall(query, filter);
      },
    };
    const synthesizer = createDefaultSynthesizer(ctx);
    activeProvider = new AnswerProviderImpl({
      recall: recallSeam,
      synthesizer,
      onSynthesisError: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log.warn(`answer: synthesis failed — ${msg}`);
      },
    });
    ctx.registerProvider("answer", activeProvider);
    ctx.log.info("answer: cited-answer seam ready");
  },

  commands: (ctx) => {
    const root = new Command("__root__");
    registerAnswerCommand(root, ctx);
    return root.commands as Command[];
  },

  controlRoutes: () => answerControlRoutes(resolveActiveProvider),

  routes: () => answerApiRoutes(resolveActiveProvider),

  localClient: () => {
    const handler: AnswerClient = {
      async answer(query, filter) {
        return resolveActiveProvider().answer(query, filter);
      },
    };
    return { answer: handler };
  },

  onUnload() {
    activeProvider = null;
  },
};

export default answerModule;
