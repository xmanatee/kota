import type { DaemonTransport } from "#core/server/daemon-transport.js";
import {
  type AnswerClient,
  type AnswerFilter,
  type AnswerHistoryListFilter,
  type AnswerHistoryListResult,
  type AnswerHistoryShowResult,
  type AnswerResult,
  decodeAnswerHistoryListResult,
  decodeAnswerHistoryShowResult,
} from "./client.js";

/** Build the daemon-side answer client over the module's typed HTTP routes. */
export function buildAnswerDaemonHandler(link: DaemonTransport): AnswerClient {
  return {
    answer: async (query: string, filter?: AnswerFilter): Promise<AnswerResult> =>
      link.requestStrict<AnswerResult>("POST", "/answer", {
        query,
        ...(filter && { filter }),
      }),
    log: async (
      filter?: AnswerHistoryListFilter,
    ): Promise<AnswerHistoryListResult> => {
      const params = new URLSearchParams();
      if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
      if (filter?.beforeId !== undefined) params.set("beforeId", filter.beforeId);
      if (filter?.projectId !== undefined) params.set("projectId", filter.projectId);
      const query = params.toString() ? `?${params.toString()}` : "";
      const decoded = await link.requestStrict<unknown>("GET", `/answers${query}`);
      return decodeAnswerHistoryListResult(decoded);
    },
    show: async (id: string, project): Promise<AnswerHistoryShowResult> => {
      const params = new URLSearchParams();
      if (project?.projectId !== undefined) params.set("projectId", project.projectId);
      const query = params.toString() ? `?${params.toString()}` : "";
      const decoded = await link.requestStrict<unknown>(
        "GET",
        `/answers/${encodeURIComponent(id)}${query}`,
      );
      return decodeAnswerHistoryShowResult(decoded);
    },
  };
}
