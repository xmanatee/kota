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
import { createModelClient } from "#core/model/model-client.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type {
  AnswerClient,
  AnswerHistoryListFilter,
} from "#core/server/kota-client.js";
import type { RecallProvider } from "#modules/recall/recall-types.js";
import {
  type AnswerHistoryStore,
  answerHistoryRootForProject,
  DiskAnswerHistoryStore,
} from "./answer-history-store.js";
import { AnswerProviderImpl } from "./answer-provider.js";
import type {
  AnswerProvider,
  AnswerRecallSeam,
  SynthesisInput,
  Synthesizer,
} from "./answer-types.js";
import { registerAnswerCommand } from "./cli.js";
import { createAnswerRecallContributor } from "./recall-contributor.js";
import { answerApiRoutes, answerControlRoutes } from "./routes.js";
import {
  ANSWER_SYNTHESIS_SYSTEM_PROMPT,
  buildSynthesisUserPrompt,
} from "./synthesis-prompt.js";
import {
  ANSWER_DYNAMIC_STATE_NAME,
  buildAnswerDynamicStateProvider,
} from "./system-prompt.js";
import { createAnswerToolDef } from "./tool.js";

const ANSWER_MAX_OUTPUT_TOKENS = 1024;

let activeProvider: AnswerProvider | null = null;
let activeHistory: AnswerHistoryStore | null = null;
let recallContributorHost: RecallProvider | null = null;

function resolveActiveProvider(): AnswerProvider {
  if (!activeProvider) {
    throw new Error(
      "Answer provider is not initialized. Ensure the answer module loaded.",
    );
  }
  return activeProvider;
}

function resolveActiveHistory(): AnswerHistoryStore {
  if (!activeHistory) {
    throw new Error(
      "Answer history store is not initialized. Ensure the answer module loaded.",
    );
  }
  return activeHistory;
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
    "Cited-answer seam — one query returns one short composed answer plus typed citations resolving back to the underlying RecallHits, with persisted history for re-read and eval-corpus seeding.",
  dependencies: ["recall", "model-clients", "rendering"],

  onLoad(ctx: ModuleContext) {
    const recallSeam: AnswerRecallSeam = {
      async recall(query, filter) {
        return ctx.client.recall.recall(query, filter);
      },
    };
    const synthesizer = createDefaultSynthesizer(ctx);
    const stateRoot = join(ctx.cwd, ".kota");
    activeHistory = new DiskAnswerHistoryStore({
      rootDir: answerHistoryRootForProject(stateRoot),
    });
    activeProvider = new AnswerProviderImpl({
      recall: recallSeam,
      synthesizer,
      history: activeHistory,
      onSynthesisError: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log.warn(`answer: synthesis failed — ${msg}`);
      },
      onPersistError: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log.warn(`answer: history append failed — ${msg}`);
      },
    });
    ctx.registerProvider("answer", activeProvider);
    ctx.registerDynamicStateProvider(
      ANSWER_DYNAMIC_STATE_NAME,
      buildAnswerDynamicStateProvider(),
    );

    // Contribute the answer-history corpus to the cross-store recall seam
    // through `RecallProvider`'s public registration API. The recall module
    // exposes its provider through the same `ctx.registerProvider("recall",
    // …)` seam every other provider uses, and `recall` is declared in this
    // module's `dependencies`, so the loader has already populated the
    // registry by the time this `onLoad` runs.
    const recallProvider = ctx.getProvider<RecallProvider>("recall");
    if (!recallProvider) {
      throw new Error(
        "answer module: `recall` provider is not registered. The recall module must load before answer (declared via dependencies).",
      );
    }
    recallProvider.register(createAnswerRecallContributor(activeHistory));
    recallContributorHost = recallProvider;

    ctx.log.info("answer: cited-answer seam ready");
  },

  commands: (ctx) => {
    const root = new Command("__root__");
    registerAnswerCommand(root, ctx);
    return root.commands as Command[];
  },

  tools: () => [createAnswerToolDef(resolveActiveProvider)],

  controlRoutes: () => answerControlRoutes(resolveActiveProvider, resolveActiveHistory),

  routes: () => answerApiRoutes(resolveActiveProvider, resolveActiveHistory),

  localClient: (ctx) => {
    const localStore = new DiskAnswerHistoryStore({
      rootDir: answerHistoryRootForProject(join(ctx.cwd, ".kota")),
    });
    const handler: AnswerClient = {
      async answer(query, filter) {
        return resolveActiveProvider().answer(query, filter);
      },
      async log(filter?: AnswerHistoryListFilter) {
        const store = activeHistory ?? localStore;
        const entries = await store.listAnswers(filter);
        return { entries };
      },
      async show(id: string) {
        const store = activeHistory ?? localStore;
        const record = await store.getAnswer(id);
        return record
          ? { ok: true as const, record }
          : { ok: false as const, reason: "not_found" as const };
      },
    };
    return { answer: handler };
  },

  onUnload() {
    if (recallContributorHost) {
      recallContributorHost.unregister("answer");
      recallContributorHost = null;
    }
    activeProvider = null;
    activeHistory = null;
  },
};

export default answerModule;
