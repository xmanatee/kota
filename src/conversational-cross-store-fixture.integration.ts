/**
 * Shared fixture for the cross-store conversational integration tests.
 *
 * Builds a temp project root with real `MemoryStore`, `KnowledgeStore`,
 * and `RepoTasksDefaultStore` instances, plus production
 * `CaptureProviderImpl` / `RecallProviderImpl` / `RetractProviderImpl` /
 * `AnswerProviderImpl` providers wired to the real first-party
 * contributors. Used by:
 *
 *   - src/conversational-agent-tools.integration.test.ts
 *   - src/conversational-prompt-priming.integration.test.ts
 *
 * The two tests cover different seams (agent loop vs. dynamic system-
 * prompt registry) but share the same plumbing for stores and providers,
 * so the cross-store fixture lives here rather than being duplicated in
 * each file.
 *
 * Also exports a small set of stub helpers (`makeStubStream`,
 * `modelResponse`, `findToolResult`) the agent-loop test uses to drive
 * the openai-tools harness against a scripted ModelClient.
 */

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type {
  KotaContentBlock,
  KotaMessage,
  KotaMessageStream,
  KotaModelResponse,
  KotaTool,
} from "#core/agent-harness/message-protocol.js";
import { registerModelClientFactory } from "#core/model/model-client.js";
import type { ToolDef } from "#core/modules/module-types.js";
import type {
  ConversationData,
  ConversationMessage,
  ConversationRecord,
  HistoryProvider,
  ReindexResult,
} from "#core/modules/provider-types.js";
import { registerTool } from "#core/tools/index.js";
import {
  answerHistoryRootForProject,
  DiskAnswerHistoryStore,
} from "#modules/answer/answer-history-store.js";
import { AnswerProviderImpl } from "#modules/answer/answer-provider.js";
import type {
  AnswerRecallSeam,
  Synthesizer,
} from "#modules/answer/answer-types.js";
import { createAnswerRecallContributor } from "#modules/answer/recall-contributor.js";
import { createAnswerToolDef } from "#modules/answer/tool.js";
import { CaptureProviderImpl } from "#modules/capture/capture-provider.js";
import type {
  CaptureClassification,
  CaptureClassifier,
} from "#modules/capture/capture-types.js";
import {
  createInboxContributor as createInboxCaptureContributor,
  createKnowledgeContributor as createKnowledgeCaptureContributor,
  createMemoryContributor as createMemoryCaptureContributor,
  createTasksContributor as createTasksCaptureContributor,
} from "#modules/capture/contributors.js";
import { createCaptureToolDef } from "#modules/capture/tool.js";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryStore } from "#modules/memory/store.js";
import { openaiToolsAgentHarness } from "#modules/openai-tools-agent-harness/index.js";
import {
  createHistoryContributor,
  createKnowledgeContributor as createKnowledgeRecallContributor,
  createMemoryContributor as createMemoryRecallContributor,
  createTasksContributor as createTasksRecallContributor,
} from "#modules/recall/contributors.js";
import { RecallProviderImpl } from "#modules/recall/recall-provider.js";
import { createRecallToolDef } from "#modules/recall/tool.js";
import { RepoTasksDefaultStore } from "#modules/repo-tasks/repo-tasks-store.js";
import {
  createInboxContributor as createInboxRetractContributor,
  createKnowledgeContributor as createKnowledgeRetractContributor,
  createMemoryContributor as createMemoryRetractContributor,
  createTasksContributor as createTasksRetractContributor,
} from "#modules/retract/contributors.js";
import { RetractProviderImpl } from "#modules/retract/retract-provider.js";
import { createRetractToolDef } from "#modules/retract/tool.js";

export const SEEDED_KNOWLEDGE_TITLE = "Cross-store recall design";
export const SEEDED_KNOWLEDGE_BODY =
  "The recall seam ranks hits across stores using min-max normalization.";

export type CrossStoreFixture = {
  projectRoot: string;
  memoryStore: MemoryStore;
  knowledgeStore: KnowledgeStore;
  tasksProvider: RepoTasksDefaultStore;
  captureProvider: CaptureProviderImpl;
  recallProvider: RecallProviderImpl;
  retractProvider: RetractProviderImpl;
  answerProvider: AnswerProviderImpl;
  answerHistoryStore: DiskAnswerHistoryStore;
};

export function makeCrossStoreProjectRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "test"', { cwd: dir });
  mkdirSync(join(dir, "data", "tasks", "backlog"), { recursive: true });
  mkdirSync(join(dir, "data", "tasks", "dropped"), { recursive: true });
  mkdirSync(join(dir, "data", "inbox"), { recursive: true });
  mkdirSync(join(dir, ".kota"), { recursive: true });
  return dir;
}

export function memoryCaptureClassifier(): CaptureClassifier {
  return {
    async classify(): Promise<CaptureClassification> {
      return { kind: "confident", target: "memory" };
    },
  };
}

export function createEmptyHistoryProvider(): HistoryProvider {
  const unused = (name: string): never => {
    throw new Error(`history provider ${name}() is not used in this test`);
  };
  return {
    create: (_model: string, _cwd: string): string => unused("create"),
    save: (
      _id: string,
      _messages: ConversationMessage[],
      _compactionCount: number,
      _lastInputTokens: number,
    ): void => unused("save"),
    load: (_id: string): ConversationData | null => null,
    list: (): ConversationRecord[] => [],
    getMostRecent: (): ConversationRecord | null => null,
    findByPrefix: (): ConversationRecord | null => null,
    remove: (): boolean => false,
    cleanup: (): number => 0,
    supportsSemanticSearch: (): boolean => false,
    semanticSearch: async (): Promise<ConversationRecord[]> =>
      unused("semanticSearch"),
    reindex: async (): Promise<ReindexResult> => ({
      indexed: 0,
      failed: 0,
      skipped: true,
    }),
  };
}

export type BuildCrossStoreFixtureOptions = {
  /**
   * Optional override for the cited-answer `Synthesizer` injected through
   * `AnswerProviderOptions`. The default emits `[answer:<id>]` when an
   * `answer` recall hit is in the pile and falls back to the seeded
   * knowledge entry otherwise — same behavior the existing
   * capture/recall/answer round-trip describe relies on. Tests that need
   * to script a fabricated marker (e.g. exercising the
   * retry-and-reject contract) pass their own synthesizer here without
   * touching `AnswerProviderImpl` itself.
   */
  synthesizer?: Synthesizer;
};

export function buildCrossStoreFixture(
  prefix: string,
  options: BuildCrossStoreFixtureOptions = {},
): CrossStoreFixture {
  const projectRoot = makeCrossStoreProjectRoot(prefix);
  const memoryStore = new MemoryStore(join(projectRoot, ".kota"));
  const knowledgeStore = new KnowledgeStore(
    projectRoot,
    join(projectRoot, ".kota-global", "data"),
  );
  knowledgeStore.create({
    title: SEEDED_KNOWLEDGE_TITLE,
    content: SEEDED_KNOWLEDGE_BODY,
    tags: [],
  });
  const tasksProvider = new RepoTasksDefaultStore(projectRoot);
  const historyProvider = createEmptyHistoryProvider();

  const captureProvider = new CaptureProviderImpl({
    classifier: memoryCaptureClassifier(),
  });
  captureProvider.register(createMemoryCaptureContributor(memoryStore));
  captureProvider.register(createKnowledgeCaptureContributor(knowledgeStore));
  captureProvider.register(createTasksCaptureContributor(projectRoot));
  captureProvider.register(createInboxCaptureContributor(projectRoot));

  const recallProvider = new RecallProviderImpl({
    onContributorError: () => {},
  });
  recallProvider.register(createKnowledgeRecallContributor(knowledgeStore));
  recallProvider.register(createMemoryRecallContributor(memoryStore));
  recallProvider.register(createTasksRecallContributor(tasksProvider));
  recallProvider.register(createHistoryContributor(historyProvider));
  // Answer-history is the fifth recall contributor. Registering it here
  // mirrors the answer module's `onLoad` so the conversational fixture
  // exercises the same five-source seam every operator surface sees.
  const answerHistoryStore = new DiskAnswerHistoryStore({
    rootDir: answerHistoryRootForProject(join(projectRoot, ".kota")),
  });
  recallProvider.register(createAnswerRecallContributor(answerHistoryStore));

  const retractProvider = new RetractProviderImpl();
  retractProvider.register(createMemoryRetractContributor(memoryStore));
  retractProvider.register(createKnowledgeRetractContributor(knowledgeStore));
  retractProvider.register(createTasksRetractContributor(projectRoot));
  retractProvider.register(createInboxRetractContributor(projectRoot));

  const recallSeam: AnswerRecallSeam = {
    async recall(query, filter) {
      const hits = await recallProvider.recall(query, filter);
      return { ok: true, hits };
    },
  };
  const defaultSynthesizer: Synthesizer = async ({ hits }) => {
    // If the recall pile contains a prior cited answer for a similar query,
    // chain through it so the test asserts that re-asking does not silently
    // re-synthesize from raw stores when an `answer`-source hit is present.
    const answerHit = hits.find((h) => h.source === "answer");
    if (answerHit) {
      return `The prior cited answer [answer:${answerHit.id}] still applies.`;
    }
    const knowledgeHit = hits.find((h) => h.source === "knowledge");
    if (!knowledgeHit) {
      throw new Error("expected knowledge hit in seeded fixture");
    }
    return `The recall seam ranks hits using min-max normalization [knowledge:${knowledgeHit.id}].`;
  };
  const answerProvider = new AnswerProviderImpl({
    recall: recallSeam,
    synthesizer: options.synthesizer ?? defaultSynthesizer,
    history: answerHistoryStore,
  });

  return {
    projectRoot,
    memoryStore,
    knowledgeStore,
    tasksProvider,
    captureProvider,
    recallProvider,
    retractProvider,
    answerProvider,
    answerHistoryStore,
  };
}

export function makeStubStream(final: KotaModelResponse): KotaMessageStream {
  const stream: KotaMessageStream = {
    on(event: "text" | "thinking", cb: (delta: string) => void) {
      if (event === "text") {
        for (const block of final.content) {
          if (block.type === "text") cb(block.text);
        }
      }
      return stream;
    },
    finalMessage: async (): Promise<KotaModelResponse> => final,
  };
  return stream;
}

export function modelResponse(
  id: string,
  content: KotaContentBlock[],
  stop_reason: KotaModelResponse["stop_reason"],
): KotaModelResponse {
  return {
    id,
    role: "assistant",
    model: "stub-model",
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
  };
}

export type StreamCallSnapshot = {
  tools: readonly KotaTool[] | undefined;
  messages: KotaMessage[];
};

export function findLastToolResult(
  snapshots: readonly StreamCallSnapshot[],
  toolUseId: string,
): string | undefined {
  // Tool results are appended into successive snapshots' message lists;
  // scan from the latest snapshot back so the test sees the most recent
  // rendering the harness fed the model.
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    for (const msg of snapshots[i].messages) {
      if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "tool_result" &&
          "tool_use_id" in block &&
          block.tool_use_id === toolUseId
        ) {
          const content = "content" in block ? block.content : undefined;
          if (typeof content === "string") return content;
        }
      }
    }
  }
  return undefined;
}

export function registerCrossStoreTools(fixture: CrossStoreFixture): void {
  const defs: ReadonlyArray<{ name: string; def: ToolDef }> = [
    {
      name: "capture",
      def: createCaptureToolDef(() => fixture.captureProvider),
    },
    { name: "recall", def: createRecallToolDef(() => fixture.recallProvider) },
    { name: "answer", def: createAnswerToolDef(() => fixture.answerProvider) },
    {
      name: "retract",
      def: createRetractToolDef(() => fixture.retractProvider),
    },
  ];
  for (const { name, def } of defs) {
    registerTool(def.tool, def.runner, name, {
      risk: def.risk,
      kind: def.kind,
    });
  }
}

export type ScriptedTurn = (
  snapshots: readonly StreamCallSnapshot[],
) => KotaMessageStream;

export async function runScriptedAgentSession(opts: {
  prompt: string;
  pickStream: ScriptedTurn;
  snapshots: StreamCallSnapshot[];
}): Promise<void> {
  const streamMock = vi.fn(
    (params: { tools?: readonly KotaTool[]; messages: KotaMessage[] }): KotaMessageStream => {
      opts.snapshots.push({
        tools: params.tools ? [...params.tools] : undefined,
        messages: JSON.parse(JSON.stringify(params.messages)) as KotaMessage[],
      });
      return opts.pickStream(opts.snapshots);
    },
  );
  registerModelClientFactory(({ model }) => ({
    client: { messages: { create: vi.fn(), stream: streamMock } },
    model,
    providerName: "stub",
  }));
  await openaiToolsAgentHarness.run({
    prompt: opts.prompt,
    model: "openai/gpt-4o-mini",
    effort: "xhigh",
    systemPrompt: "be terse",
  });
}

export function toolUseTurn(
  msgId: string,
  callId: string,
  name: string,
  input: Record<string, unknown>,
): KotaMessageStream {
  return makeStubStream(
    modelResponse(
      msgId,
      [
        {
          type: "tool_use",
          id: callId,
          name,
          input,
        } as KotaContentBlock,
      ],
      "tool_use",
    ),
  );
}

export function endTurn(msgId: string, text: string): KotaMessageStream {
  return makeStubStream(
    modelResponse(
      msgId,
      [{ type: "text", text } as KotaContentBlock],
      "end_turn",
    ),
  );
}
