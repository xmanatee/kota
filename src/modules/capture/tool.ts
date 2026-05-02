/**
 * Capture tool — agent-callable wrapper over the in-process `CaptureProvider`.
 *
 * The tool lets a per-user agent session route a noteworthy chat-resident
 * fact through the same classifier + contributor registry every other
 * surface uses. Inputs and outputs map 1:1 onto `CaptureProvider.capture`;
 * the tool adds nothing beyond the JSON-Schema entry point and shared
 * plain-text rendering so the transcript matches the slash-command surface
 * byte-for-byte.
 */
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolDef } from "#core/modules/module-types.js";
import { localWriteEffect } from "#core/tools/effect.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import type {
  CaptureFilter,
  CaptureProvider,
  CaptureTarget,
} from "./capture-types.js";
import { renderCaptureResultPlain } from "./render.js";

const CAPTURE_TARGETS: ReadonlyArray<CaptureTarget> = [
  "memory",
  "knowledge",
  "tasks",
  "inbox",
];

export const captureTool: KotaTool = {
  name: "capture",
  description:
    "Save a noteworthy natural-language fact into the right cross-store slot " +
    "(memory, knowledge, tasks, inbox). When `target` is set the seam dispatches " +
    "verbatim; otherwise an internal classifier picks the destination or returns " +
    "an ambiguous envelope listing the suggestions. Use this to persist mid-" +
    "conversation facts that would otherwise require an explicit /capture command.",
  input_schema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description:
          "The natural-language note to capture. Empty/whitespace-only text " +
          "surfaces an ambiguous envelope and writes nothing.",
      },
      target: {
        type: "string",
        enum: [...CAPTURE_TARGETS],
        description:
          "Optional explicit destination store. When omitted the classifier " +
          "decides; when present the seam dispatches without classification.",
      },
      hint: {
        type: "string",
        description:
          "Optional free-form hint forwarded to the classifier when no target " +
          "is supplied. Ignored when `target` is set.",
      },
    },
    required: ["text"],
  },
};

export function createCaptureToolRunner(
  resolveProvider: () => CaptureProvider,
): (input: Record<string, unknown>) => Promise<ToolResult> {
  return async (input) => {
    const text = input.text;
    if (typeof text !== "string") {
      return {
        content: "Capture failed: `text` must be a string.",
        is_error: true,
      };
    }
    const filter: CaptureFilter = {};
    if (input.target !== undefined) {
      if (
        typeof input.target !== "string" ||
        !CAPTURE_TARGETS.includes(input.target as CaptureTarget)
      ) {
        return {
          content: `Capture failed: \`target\` must be one of ${CAPTURE_TARGETS.join(", ")}.`,
          is_error: true,
        };
      }
      filter.target = input.target as CaptureTarget;
    }
    if (input.hint !== undefined) {
      if (typeof input.hint !== "string") {
        return {
          content: "Capture failed: `hint` must be a string when supplied.",
          is_error: true,
        };
      }
      filter.hint = input.hint;
    }

    const result = await resolveProvider().capture(text, filter);
    const content = renderCaptureResultPlain(result);
    return result.ok ? { content } : { content, is_error: true };
  };
}

export function createCaptureToolDef(
  resolveProvider: () => CaptureProvider,
): ToolDef {
  return {
    tool: captureTool,
    runner: createCaptureToolRunner(resolveProvider),
    effect: localWriteEffect(),
  };
}
