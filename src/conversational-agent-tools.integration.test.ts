/**
 * End-to-end test for the agent-callable cross-store seam tools.
 *
 * Boots a per-user agent session through the `openai-tools` harness against
 * the production capture/recall/answer providers wired to real on-disk
 * stores. A scripted ModelClient drives one session in which the agent
 * fires three tool_use blocks in sequence (`capture`, `recall`, `answer`)
 * and finishes with a plain text reply.
 *
 * The test asserts the bullets in the task's "Done When":
 *
 *   (a) `capture` writes through the real `CaptureProvider` and the
 *       resulting `CaptureRecord` is reachable in the matching memory
 *       store.
 *   (b) `recall` returns ranked hits across registered contributors —
 *       captured by inspecting the tool_result block the harness fed back
 *       to the model on the next turn.
 *   (c) `answer` produces a cited answer through the real
 *       `AnswerProvider` and a fresh `AnswerHistoryRecord` is appended
 *       to the same `DiskAnswerHistoryStore` `KotaClient.answer.log`
 *       reads from.
 */

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  KotaContentBlock,
  KotaMessage,
  KotaModelResponse,
  KotaTool,
} from "#core/agent-harness/message-protocol.js";
import { registerModelClientFactory } from "#core/model/model-client.js";
import type {
  ConversationData,
  ConversationMessage,
  ConversationRecord,
  HistoryProvider,
  ReindexResult,
} from "#core/modules/provider-types.js";
import {
  clearCustomTools,
  registerTool,
} from "#core/tools/index.js";
import {
  answerHistoryRootForProject,
  DiskAnswerHistoryStore,
} from "#modules/answer/answer-history-store.js";
import { AnswerProviderImpl } from "#modules/answer/answer-provider.js";
import type {
  AnswerRecallSeam,
  Synthesizer,
} from "#modules/answer/answer-types.js";
import { createAnswerToolDef } from "#modules/answer/tool.js";
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

const SEEDED_KNOWLEDGE_TITLE = "Cross-store recall design";
const SEEDED_KNOWLEDGE_BODY =
  "The recall seam ranks hits across stores using min-max normalization.";
const CAPTURE_NOTE = "Operator wants xhighmnemo decomposer default for autonomy steps.";
const RECALL_QUERY = "min-max normalization";
const ANSWER_QUERY = "How does the recall seam rank hits?";

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
    list: (_opts?: {
      search?: string;
      limit?: number;
      cwd?: string;
      source?: "user" | "action";
    }): ConversationRecord[] => [],
    getMostRecent: (_cwd?: string): ConversationRecord | null => null,
    findByPrefix: (_idOrPrefix: string): ConversationRecord | null => null,
    remove: (_id: string): boolean => false,
    cleanup: (): number => 0,
    supportsSemanticSearch: (): boolean => false,
    semanticSearch: async (): Promise<ConversationRecord[]> => unused("semanticSearch"),
    reindex: async (): Promise<ReindexResult> => ({
      indexed: 0,
      failed: 0,
      skipped: true,
    }),
  };
}

function makeProjectRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "kota-conv-tools-"));
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "test"', { cwd: dir });
  mkdirSync(join(dir, "data", "tasks", "backlog"), { recursive: true });
  mkdirSync(join(dir, "data", "inbox"), { recursive: true });
  mkdirSync(join(dir, ".kota"), { recursive: true });
  return dir;
}

function memoryCaptureClassifier(): CaptureClassifier {
  return {
    async classify(): Promise<CaptureClassification> {
      return { kind: "confident", target: "memory" };
    },
  };
}

function makeStubStream(final: KotaModelResponse) {
  return {
    on(event: "text" | "thinking", cb: (delta: string) => void) {
      if (event === "text") {
        for (const block of final.content) {
          if (block.type === "text") cb(block.text);
        }
      }
      return this;
    },
    finalMessage: async (): Promise<KotaModelResponse> => final,
  };
}

function modelResponse(
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

type StreamCallSnapshot = {
  tools: readonly KotaTool[] | undefined;
  messages: KotaMessage[];
};

describe("conversational agent tools (capture / recall / answer)", () => {
  let projectRoot: string;
  let memoryStore: MemoryStore;
  let answerHistoryStore: DiskAnswerHistoryStore;
  let streamCallSnapshots: StreamCallSnapshot[];

  beforeAll(async () => {
    clearCustomTools();
    streamCallSnapshots = [];
    projectRoot = makeProjectRoot();
    memoryStore = new MemoryStore(join(projectRoot, ".kota"));
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
    captureProvider.register(createInboxContributor(projectRoot));

    const recallProvider = new RecallProviderImpl({
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
    const answerProvider = new AnswerProviderImpl({
      recall: recallSeam,
      synthesizer,
      history: answerHistoryStore,
    });

    const captureToolDef = createCaptureToolDef(() => captureProvider);
    registerTool(captureToolDef.tool, captureToolDef.runner, "capture", {
      risk: captureToolDef.risk,
      kind: captureToolDef.kind,
    });
    const recallToolDef = createRecallToolDef(() => recallProvider);
    registerTool(recallToolDef.tool, recallToolDef.runner, "recall", {
      risk: recallToolDef.risk,
      kind: recallToolDef.kind,
    });
    const answerToolDef = createAnswerToolDef(() => answerProvider);
    registerTool(answerToolDef.tool, answerToolDef.runner, "answer", {
      risk: answerToolDef.risk,
      kind: answerToolDef.kind,
    });

    const streamReturnQueue = [
      makeStubStream(
        modelResponse(
          "msg_capture",
          [
            {
              type: "tool_use",
              id: "call_capture",
              name: "capture",
              input: { text: CAPTURE_NOTE, target: "memory" },
            } as KotaContentBlock,
          ],
          "tool_use",
        ),
      ),
      makeStubStream(
        modelResponse(
          "msg_recall",
          [
            {
              type: "tool_use",
              id: "call_recall",
              name: "recall",
              input: { query: RECALL_QUERY },
            } as KotaContentBlock,
          ],
          "tool_use",
        ),
      ),
      makeStubStream(
        modelResponse(
          "msg_answer",
          [
            {
              type: "tool_use",
              id: "call_answer",
              name: "answer",
              input: { query: ANSWER_QUERY },
            } as KotaContentBlock,
          ],
          "tool_use",
        ),
      ),
      makeStubStream(
        modelResponse(
          "msg_done",
          [{ type: "text", text: "all done" } as KotaContentBlock],
          "end_turn",
        ),
      ),
    ];

    const streamMock = vi.fn(
      (params: {
        tools?: readonly KotaTool[];
        messages: KotaMessage[];
      }) => {
        streamCallSnapshots.push({
          tools: params.tools ? [...params.tools] : undefined,
          messages: JSON.parse(JSON.stringify(params.messages)) as KotaMessage[],
        });
        const next = streamReturnQueue.shift();
        if (!next) throw new Error("streamMock: no scripted return value");
        return next;
      },
    );

    registerModelClientFactory(({ model }) => ({
      client: {
        messages: { create: vi.fn(), stream: streamMock },
      },
      model,
      providerName: "stub",
    }));

    await openaiToolsAgentHarness.run({
      prompt: "exercise the cross-store agent tools",
      model: "openai/gpt-4o-mini",
      effort: "xhigh",
      systemPrompt: "be terse",
    });
  });

  afterAll(() => {
    clearCustomTools();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("registers all three agent-callable tools and exposes them on every turn", () => {
    expect(streamCallSnapshots.length).toBeGreaterThanOrEqual(4);
    const toolNames = streamCallSnapshots[0].tools?.map((t) => t.name) ?? [];
    expect(toolNames).toContain("capture");
    expect(toolNames).toContain("recall");
    expect(toolNames).toContain("answer");
  });

  it("(a) capture wrote a typed memory record reachable through the underlying MemoryStore", () => {
    const captured = memoryStore.list().find((r) => r.content === CAPTURE_NOTE);
    expect(captured).toBeDefined();

    // The harness fed the typed CaptureRecord rendering back to the model.
    const captureToolResult = findToolResult(streamCallSnapshots, "call_capture");
    expect(captureToolResult).toBeDefined();
    expect(captureToolResult).toContain("Captured: memory");
  });

  it("(b) recall returned ranked hits across registered contributors and the harness fed the rendered hits back to the model", () => {
    const recallToolResult = findToolResult(streamCallSnapshots, "call_recall");
    expect(recallToolResult).toBeDefined();
    if (!recallToolResult) throw new Error("unreachable");
    // Knowledge entry seeded with the body should appear in the rendered hit
    // list, anchoring the recall side of the round trip.
    expect(recallToolResult).toContain("knowledge");
    expect(recallToolResult).toContain(SEEDED_KNOWLEDGE_TITLE);
  });

  it("(c) answer produced a cited envelope and appended one AnswerHistoryRecord that includes the cross-store recall hits the synthesizer was shown", async () => {
    const answerToolResult = findToolResult(streamCallSnapshots, "call_answer");
    expect(answerToolResult).toBeDefined();
    if (!answerToolResult) throw new Error("unreachable");
    expect(answerToolResult).toContain("min-max normalization");
    expect(answerToolResult).toContain("Citations");
    expect(answerToolResult).toContain("knowledge");

    const entries = await answerHistoryStore.listAnswers();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const newest = entries[0];
    expect(newest.query).toBe(ANSWER_QUERY);
    expect(newest.result.ok).toBe(true);
    if (!newest.result.ok) throw new Error("unreachable");
    expect(newest.result.citationCount).toBeGreaterThanOrEqual(1);

    const record = await answerHistoryStore.getAnswer(newest.id);
    if (!record) throw new Error("expected stored answer record");
    expect(record.result.ok).toBe(true);
    if (!record.result.ok) throw new Error("unreachable");
    const sources = new Set(record.recallHits.map((h) => h.source));
    expect(sources.has("knowledge")).toBe(true);
    const citation = record.result.citations[0];
    const matchedHit = record.recallHits.find(
      (h) => h.source === citation.source && h.id === citation.id,
    );
    expect(matchedHit).toBeDefined();
  });
});

function findToolResult(
  snapshots: StreamCallSnapshot[],
  toolUseId: string,
): string | undefined {
  for (const snap of snapshots) {
    for (const msg of snap.messages) {
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
