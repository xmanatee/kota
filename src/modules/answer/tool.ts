/**
 * Answer tool — agent-callable surface for the registered `AnswerClient`.
 *
 * The tool lets a per-user agent session produce a cited answer mid-
 * conversation, going through the same recall + synthesizer + history-
 * append path every other surface uses. Inputs and outputs map 1:1 onto
 * `AnswerClient.answer`; the rendered transcript matches the slash-
 * command surface byte-for-byte through `renderAnswerReplyPlain`, and
 * every successful call appends one `AnswerHistoryRecord` so the answer
 * shows up in `/answer-log` like any other cited answer.
 */
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolDef } from "#core/modules/module-types.js";
import { daemonWriteEffect } from "#core/tools/effect.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import type { RecallSource } from "#modules/recall/client.js";
import { isRecallSource, RECALL_SOURCE_ORDER } from "#modules/recall/recall-types.js";
import type {
  AnswerClient,
  AnswerFilter,
} from "./client.js";
import { renderAnswerReplyPlain } from "./render.js";

export const answerTool: KotaTool = {
  name: "answer",
  description:
    "Compose one short cited answer to a natural-language question by running the " +
    "cross-store recall fan-out and asking the model to synthesize a reply with " +
    "typed `[source:id]` citations. Every call appends one record to the answer " +
    "history, so the conversational answer is reachable from `/answer-log` and " +
    "the macOS, web, mobile, Slack, Telegram, and CLI history surfaces.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The natural-language question to answer.",
      },
      topK: {
        type: "integer",
        minimum: 1,
        description:
          "Optional cap on the recall hit pile fed to the synthesizer.",
      },
      minScore: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Optional floor on the normalized recall score in `[0, 1]`.",
      },
      sources: {
        type: "array",
        items: { type: "string", enum: [...RECALL_SOURCE_ORDER] },
        description:
          "Optional subset of recall sources to query. Defaults to every " +
          "registered contributor.",
      },
    },
    required: ["query"],
  },
};

export function createAnswerToolRunner(
  resolveProvider: () => AnswerClient,
): (input: Record<string, unknown>) => Promise<ToolResult> {
  return async (input) => {
    const query = input.query;
    if (typeof query !== "string") {
      return {
        content: "Answer failed: `query` must be a string.",
        is_error: true,
      };
    }
    const filter: AnswerFilter = {};
    if (input.topK !== undefined) {
      if (typeof input.topK !== "number" || !Number.isInteger(input.topK) || input.topK < 1) {
        return {
          content: "Answer failed: `topK` must be a positive integer when supplied.",
          is_error: true,
        };
      }
      filter.topK = input.topK;
    }
    if (input.minScore !== undefined) {
      if (typeof input.minScore !== "number" || input.minScore < 0 || input.minScore > 1) {
        return {
          content: "Answer failed: `minScore` must be a number in [0, 1] when supplied.",
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
            isRecallSource(s),
        )
      ) {
        return {
          content: `Answer failed: \`sources\` must be a list of ${RECALL_SOURCE_ORDER.join(", ")}.`,
          is_error: true,
        };
      }
      filter.sources = input.sources as RecallSource[];
    }

    const result = await resolveProvider().answer(query, filter);
    const content = renderAnswerReplyPlain(result);
    return result.ok ? { content } : { content, is_error: true };
  };
}

export function createAnswerToolDef(
  resolveProvider: () => AnswerClient,
): ToolDef {
  return {
    tool: answerTool,
    runner: createAnswerToolRunner(resolveProvider),
    effect: daemonWriteEffect(),
  };
}
