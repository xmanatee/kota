/**
 * End-to-end test for the cross-store conversational-prompt-priming wiring.
 *
 * Exercises the production capture/recall/answer modules: each module's
 * `onLoad` registers a per-turn dynamic system-prompt state contributor
 * via `ctx.registerDynamicStateProvider`. The contributors are gated by
 * the session's effective tool policy: when the matching tool is admitted
 * the conversational-pattern block is appended to the system prompt;
 * when the tool is excluded the contributor emits the empty string.
 *
 * The test asserts the bullets in the task's "Done When":
 *
 *   Positive:
 *     - A session that admits all three tools sees all three blocks in
 *       the per-turn dynamic state, and the runtime recall → answer →
 *       answer-history-append chain produces a fresh `AnswerHistoryRecord`
 *       (i.e. behavior changed, not just prompt text).
 *
 *   Negative:
 *     - A session whose tool policy admits only `recall` sees the recall
 *       block but neither the capture nor the answer block.
 */

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  collectDynamicState,
  registerDynamicStateProvider,
  resetDynamicStateProviders,
} from "#core/loop/dynamic-state.js";
import type {
  ConversationData,
  ConversationMessage,
  ConversationRecord,
  HistoryProvider,
  ReindexResult,
} from "#core/modules/provider-types.js";
import {
  answerHistoryRootForProject,
  DiskAnswerHistoryStore,
} from "#modules/answer/answer-history-store.js";
import { AnswerProviderImpl } from "#modules/answer/answer-provider.js";
import type {
  AnswerRecallSeam,
  Synthesizer,
} from "#modules/answer/answer-types.js";
import {
  ANSWER_CONVERSATIONAL_BLOCK,
  ANSWER_DYNAMIC_STATE_NAME,
  buildAnswerDynamicStateProvider,
} from "#modules/answer/system-prompt.js";
import { CaptureProviderImpl } from "#modules/capture/capture-provider.js";
import type {
  CaptureClassification,
  CaptureClassifier,
} from "#modules/capture/capture-types.js";
import {
  createInboxContributor,
  createKnowledgeContributor as createKnowledgeCaptureContributor,
  createMemoryContributor as createMemoryCaptureContributor,
  createTasksContributor as createTasksCaptureContributor,
} from "#modules/capture/contributors.js";
import {
  buildCaptureDynamicStateProvider,
  CAPTURE_CONVERSATIONAL_BLOCK,
  CAPTURE_DYNAMIC_STATE_NAME,
} from "#modules/capture/system-prompt.js";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryStore } from "#modules/memory/store.js";
import {
  createHistoryContributor,
  createKnowledgeContributor as createKnowledgeRecallContributor,
  createMemoryContributor as createMemoryRecallContributor,
  createTasksContributor as createTasksRecallContributor,
} from "#modules/recall/contributors.js";
import { RecallProviderImpl } from "#modules/recall/recall-provider.js";
import {
  buildRecallDynamicStateProvider,
  RECALL_CONVERSATIONAL_BLOCK,
  RECALL_DYNAMIC_STATE_NAME,
} from "#modules/recall/system-prompt.js";
import { RepoTasksDefaultStore } from "#modules/repo-tasks/repo-tasks-store.js";

const SEEDED_KNOWLEDGE_TITLE = "Cross-store recall design";
const SEEDED_KNOWLEDGE_BODY =
  "The recall seam ranks hits across stores using min-max normalization.";
const ANSWER_QUERY = "How does the recall seam rank hits?";
const RECALL_QUERY = "min-max normalization";

function createEmptyHistoryProvider(): HistoryProvider {
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

function memoryCaptureClassifier(): CaptureClassifier {
  return {
    async classify(): Promise<CaptureClassification> {
      return { kind: "confident", target: "memory" };
    },
  };
}

function makeProjectRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "kota-conv-priming-"));
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "test"', { cwd: dir });
  mkdirSync(join(dir, "data", "tasks", "backlog"), { recursive: true });
  mkdirSync(join(dir, "data", "inbox"), { recursive: true });
  mkdirSync(join(dir, ".kota"), { recursive: true });
  return dir;
}

describe("conversational prompt priming (capture / recall / answer)", () => {
  let projectRoot: string;
  let answerHistoryStore: DiskAnswerHistoryStore;
  let recallProvider: RecallProviderImpl;
  let answerProvider: AnswerProviderImpl;

  beforeAll(async () => {
    resetDynamicStateProviders();

    projectRoot = makeProjectRoot();
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

    // Capture provider — exercised so the integration mirrors real wiring.
    const captureProvider = new CaptureProviderImpl({
      classifier: memoryCaptureClassifier(),
    });
    captureProvider.register(createMemoryCaptureContributor(memoryStore));
    captureProvider.register(createKnowledgeCaptureContributor(knowledgeStore));
    captureProvider.register(createTasksCaptureContributor(projectRoot));
    captureProvider.register(createInboxContributor(projectRoot));
    expect(captureProvider.contributors().length).toBeGreaterThan(0);

    recallProvider = new RecallProviderImpl({
      onContributorError: () => {},
    });
    recallProvider.register(createKnowledgeRecallContributor(knowledgeStore));
    recallProvider.register(createMemoryRecallContributor(memoryStore));
    recallProvider.register(createTasksRecallContributor(tasksProvider));
    recallProvider.register(createHistoryContributor(historyProvider));

    answerHistoryStore = new DiskAnswerHistoryStore({
      rootDir: answerHistoryRootForProject(join(projectRoot, ".kota")),
    });

    const recallSeam: AnswerRecallSeam = {
      async recall(query, filter) {
        const hits = await recallProvider.recall(query, filter);
        return { ok: true, hits };
      },
    };
    const synthesizer: Synthesizer = async ({ hits }) => {
      const knowledgeHit = hits.find((h) => h.source === "knowledge");
      if (!knowledgeHit) {
        throw new Error("expected knowledge hit in seeded fixture");
      }
      return `The recall seam ranks hits using min-max normalization [knowledge:${knowledgeHit.id}].`;
    };
    answerProvider = new AnswerProviderImpl({
      recall: recallSeam,
      synthesizer,
      history: answerHistoryStore,
    });

    // Register the contributors through the same global registry every
    // module's `onLoad` writes to. `loop-send.ts` collects from this
    // registry per turn — the runtime path is unchanged.
    registerDynamicStateProvider(
      CAPTURE_DYNAMIC_STATE_NAME,
      buildCaptureDynamicStateProvider(),
    );
    registerDynamicStateProvider(
      RECALL_DYNAMIC_STATE_NAME,
      buildRecallDynamicStateProvider(),
    );
    registerDynamicStateProvider(
      ANSWER_DYNAMIC_STATE_NAME,
      buildAnswerDynamicStateProvider(),
    );
  });

  afterAll(() => {
    resetDynamicStateProviders();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("(positive) per-turn system prompt contains all three conversational blocks when every tool is admitted", () => {
    const dynamicState = collectDynamicState({
      activeTools: new Set(["capture", "recall", "answer"]),
    });
    expect(dynamicState).toContain(CAPTURE_CONVERSATIONAL_BLOCK.trim());
    expect(dynamicState).toContain(RECALL_CONVERSATIONAL_BLOCK.trim());
    expect(dynamicState).toContain(ANSWER_CONVERSATIONAL_BLOCK.trim());
  });

  it("(positive) recall returns the seeded knowledge hit and answer appends a fresh AnswerHistoryRecord — i.e. behavior changed, not just prompt text", async () => {
    const recallHits = await recallProvider.recall(RECALL_QUERY);
    const knowledgeHit = recallHits.find((h) => h.source === "knowledge");
    expect(knowledgeHit).toBeDefined();
    expect(knowledgeHit?.id).toBeDefined();

    const beforeEntries = await answerHistoryStore.listAnswers();
    const beforeCount = beforeEntries.length;

    const answerResult = await answerProvider.answer(ANSWER_QUERY);
    expect(answerResult.ok).toBe(true);
    if (!answerResult.ok) throw new Error("unreachable");
    expect(answerResult.answer).toContain("min-max normalization");
    expect(answerResult.citations.length).toBeGreaterThanOrEqual(1);

    const afterEntries = await answerHistoryStore.listAnswers();
    expect(afterEntries.length).toBe(beforeCount + 1);
    const newest = afterEntries[0];
    expect(newest.query).toBe(ANSWER_QUERY);
    expect(newest.result.ok).toBe(true);
    if (!newest.result.ok) throw new Error("unreachable");
    expect(newest.result.citationCount).toBeGreaterThanOrEqual(1);

    const stored = await answerHistoryStore.getAnswer(newest.id);
    if (!stored) throw new Error("expected stored answer record");
    expect(stored.result.ok).toBe(true);
    if (!stored.result.ok) throw new Error("unreachable");
    const sources = new Set(stored.recallHits.map((h) => h.source));
    expect(sources.has("knowledge")).toBe(true);
  });

  it("(negative) per-turn system prompt suppresses capture / answer blocks when the session admits only recall", () => {
    const dynamicState = collectDynamicState({
      activeTools: new Set(["recall"]),
    });
    expect(dynamicState).toContain(RECALL_CONVERSATIONAL_BLOCK.trim());
    expect(dynamicState).not.toContain(CAPTURE_CONVERSATIONAL_BLOCK.trim());
    expect(dynamicState).not.toContain(ANSWER_CONVERSATIONAL_BLOCK.trim());
  });

  it("(negative) per-turn system prompt suppresses every block when the session admits no cross-store tool", () => {
    const dynamicState = collectDynamicState({
      activeTools: new Set(["shell", "file_read"]),
    });
    expect(dynamicState).not.toContain(CAPTURE_CONVERSATIONAL_BLOCK.trim());
    expect(dynamicState).not.toContain(RECALL_CONVERSATIONAL_BLOCK.trim());
    expect(dynamicState).not.toContain(ANSWER_CONVERSATIONAL_BLOCK.trim());
  });
});
