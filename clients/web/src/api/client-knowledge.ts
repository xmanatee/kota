import {
  parseAnswerHistoryListResult,
  parseAnswerHistoryShowResult,
  parseAnswerResult,
  parseAttentionResponse,
  parseCaptureResult,
  parseDigestResponse,
  parseHistorySearchResponse,
  parseKnowledgeSearchResponse,
  parseMemorySearchResponse,
  parseRecallResult,
  parseRetractResult,
  parseTasksSearchResponse,
} from "../../../conformance/daemon-contract.generated";
import { apiDecoded, apiJson } from "./client-runtime";
import type {
  AnswerHistoryListFilter,
  AnswerHistoryListResult,
  AnswerHistoryShowResult,
  AnswerResult,
  AttentionResponse,
  CaptureFilter,
  CaptureResult,
  DigestResponse,
  HistorySearchResponse,
  KnowledgeSearchResponse,
  MemorySearchResponse,
  RecallResult,
  RetractRequest,
  RetractResult,
  SlashCommand,
  SlashCommandInvocation,
  TasksSearchResponse,
} from "./types";

function semanticSearch<T>(
  path: string,
  query: string,
  limit: number,
  decode: (raw: unknown) => T,
) {
  const params = new URLSearchParams({
    q: query,
    semantic: "true",
    limit: String(limit),
  });
  return apiDecoded(`${path}?${params.toString()}`, decode);
}

export const knowledgeApi = {
  getDigest: (): Promise<DigestResponse> =>
    apiDecoded("/api/digest", parseDigestResponse),
  getAttention: (): Promise<AttentionResponse> =>
    apiDecoded("/api/attention", parseAttentionResponse),
  recall: (query: string): Promise<RecallResult> =>
    apiDecoded("/api/recall", parseRecallResult, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }),
  answer: (query: string): Promise<AnswerResult> =>
    apiDecoded("/api/answer", parseAnswerResult, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }),
  capture: (text: string, filter?: CaptureFilter): Promise<CaptureResult> =>
    apiDecoded("/api/capture", parseCaptureResult, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(filter ? { text, filter } : { text }),
    }),
  retract: (request: RetractRequest): Promise<RetractResult> =>
    apiDecoded("/api/retract", parseRetractResult, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }),
  answerLog: (
    filter?: AnswerHistoryListFilter,
  ): Promise<AnswerHistoryListResult> => {
    const search = new URLSearchParams();
    if (filter?.limit !== undefined) search.set("limit", String(filter.limit));
    if (filter?.beforeId !== undefined) search.set("beforeId", filter.beforeId);
    const query = search.toString();
    return apiDecoded(
      `/api/answers${query ? `?${query}` : ""}`,
      parseAnswerHistoryListResult,
    );
  },
  answerShow: (id: string): Promise<AnswerHistoryShowResult> =>
    apiDecoded(
      `/api/answers/${encodeURIComponent(id)}`,
      parseAnswerHistoryShowResult,
    ),
  knowledge: {
    search: (query: string, limit = 10): Promise<KnowledgeSearchResponse> =>
      semanticSearch(
        "/api/knowledge/search",
        query,
        limit,
        parseKnowledgeSearchResponse,
      ),
  },
  memory: {
    search: (query: string, limit = 10): Promise<MemorySearchResponse> =>
      semanticSearch(
        "/api/memory/search",
        query,
        limit,
        parseMemorySearchResponse,
      ),
  },
  history: {
    search: (query: string, limit = 10): Promise<HistorySearchResponse> =>
      semanticSearch(
        "/api/history/search",
        query,
        limit,
        parseHistorySearchResponse,
      ),
  },
  tasks: {
    search: (query: string, limit = 10): Promise<TasksSearchResponse> =>
      semanticSearch("/tasks/search", query, limit, parseTasksSearchResponse),
  },
  listSlashCommands: () =>
    apiJson<{ commands: SlashCommand[] }>("/api/commands"),
  invokeSlashCommand: (name: string) =>
    apiJson<SlashCommandInvocation>("/api/commands/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
};
