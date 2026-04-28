/**
 * Recall tool — agent-callable wrapper over the in-process `RecallProvider`.
 *
 * The tool lets a per-user agent session pull cross-store context (knowledge,
 * memory, history, tasks) before forming a reply, going through the same
 * provider, contributors, ranking, and source attribution every other surface
 * uses. The result is rendered with the shared `renderRecallHitsPlain` so the
 * tool transcript matches the slash-command surface byte-for-byte.
 */
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolDef } from "#core/modules/module-types.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import type {
  RecallFilter,
  RecallProvider,
  RecallSource,
} from "./recall-types.js";
import { renderRecallHitsPlain } from "./render.js";

const RECALL_SOURCES: ReadonlyArray<RecallSource> = [
  "knowledge",
  "memory",
  "history",
  "tasks",
];

export const recallTool: KotaTool = {
  name: "recall",
  description:
    "Search the second brain (knowledge, memory, conversation history, repo tasks) " +
    "for entries matching a natural-language query and return a ranked, source-tagged " +
    "list of hits. Use this to gather cross-store context before answering a question " +
    "or making a recommendation. Read-only.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The natural-language query.",
      },
      topK: {
        type: "integer",
        minimum: 1,
        description:
          "Optional cap on the merged hit list. Defaults to the seam's own cap.",
      },
      minScore: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Optional floor on the normalized score in `[0, 1]`. Defaults to 0.",
      },
      sources: {
        type: "array",
        items: { type: "string", enum: [...RECALL_SOURCES] },
        description:
          "Optional subset of sources to query. Defaults to every registered " +
          "contributor.",
      },
    },
    required: ["query"],
  },
};

export function createRecallToolRunner(
  resolveProvider: () => RecallProvider,
): (input: Record<string, unknown>) => Promise<ToolResult> {
  return async (input) => {
    const query = input.query;
    if (typeof query !== "string") {
      return {
        content: "Recall failed: `query` must be a string.",
        is_error: true,
      };
    }
    const filter: RecallFilter = {};
    if (input.topK !== undefined) {
      if (typeof input.topK !== "number" || !Number.isInteger(input.topK) || input.topK < 1) {
        return {
          content: "Recall failed: `topK` must be a positive integer when supplied.",
          is_error: true,
        };
      }
      filter.topK = input.topK;
    }
    if (input.minScore !== undefined) {
      if (typeof input.minScore !== "number" || input.minScore < 0 || input.minScore > 1) {
        return {
          content: "Recall failed: `minScore` must be a number in [0, 1] when supplied.",
          is_error: true,
        };
      }
      filter.minScore = input.minScore;
    }
    if (input.sources !== undefined) {
      if (
        !Array.isArray(input.sources) ||
        !input.sources.every(
          (s): s is RecallSource =>
            typeof s === "string" && RECALL_SOURCES.includes(s as RecallSource),
        )
      ) {
        return {
          content: `Recall failed: \`sources\` must be a list of ${RECALL_SOURCES.join(", ")}.`,
          is_error: true,
        };
      }
      filter.sources = input.sources as RecallSource[];
    }

    const provider = resolveProvider();
    if (provider.contributors().length === 0) {
      return {
        content: "Cross-store recall has no registered contributors.",
        is_error: true,
      };
    }
    const hits = await provider.recall(query, filter);
    if (hits.length === 0) {
      return { content: "No matching hits." };
    }
    return { content: renderRecallHitsPlain(hits) };
  };
}

export function createRecallToolDef(
  resolveProvider: () => RecallProvider,
): ToolDef {
  return {
    tool: recallTool,
    runner: createRecallToolRunner(resolveProvider),
    risk: "safe",
    kind: "discovery",
  };
}
