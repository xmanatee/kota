import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolDef } from "#core/modules/module-types.js";
import { daemonDestructiveEffect } from "#core/tools/effect.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import type { RetractRequest, RetractTarget } from "./client.js";
import { renderRetractResultPlain } from "./render.js";
import { RETRACT_TARGET_ORDER, type RetractProvider } from "./retract-types.js";

export const retractTool: KotaTool = {
  name: "retract",
  description:
    "Remove or drop one prior capture from memory, knowledge, tasks, or inbox. " +
    "Pass the selected store and its record id, slug, task id, or inbox path. " +
    "Tasks move to dropped; other targets remove the named record.",
  input_schema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        enum: [...RETRACT_TARGET_ORDER],
        description: "Store containing the record.",
      },
      identifier: {
        type: "string",
        description: "Record id, knowledge slug, task id, or repo-relative inbox path.",
      },
    },
    required: ["target", "identifier"],
  },
};

export function createRetractToolRunner(
  resolveProvider: () => RetractProvider,
): (
  input: Record<string, unknown>,
  context?: ToolRunnerContext,
) => Promise<ToolResult> {
  return async (input, context) => {
    if (
      typeof input.target !== "string" ||
      !(RETRACT_TARGET_ORDER as readonly string[]).includes(input.target)
    ) {
      return {
        content: `Retract failed: \`target\` must be one of ${RETRACT_TARGET_ORDER.join(", ")}.`,
        is_error: true,
      };
    }
    if (typeof input.identifier !== "string" || input.identifier.trim() === "") {
      return {
        content: "Retract failed: `identifier` must be a non-empty string.",
        is_error: true,
      };
    }
    if (!context?.scopeId) {
      return {
        content: "Retract failed: the selected session scope is unavailable.",
        is_error: true,
      };
    }
    const request: RetractRequest = {
      target: input.target as RetractTarget,
      identifier: input.identifier,
      scopeId: context.scopeId,
    };
    const result = await resolveProvider().retract(request);
    const content = renderRetractResultPlain(result);
    return result.ok ? { content } : { content, is_error: true };
  };
}

export function createRetractToolDef(
  resolveProvider: () => RetractProvider,
): ToolDef {
  return {
    tool: retractTool,
    runner: createRetractToolRunner(resolveProvider),
    effect: daemonDestructiveEffect(),
  };
}
