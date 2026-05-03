/**
 * Retract tool — agent-callable wrapper over the in-process `RetractProvider`.
 *
 * The tool lets a per-user agent session correct or remove a prior
 * cross-store capture mid-conversation. Inputs map 1:1 onto a typed
 * `RetractRequest`; outputs render through the same plain-text helper the
 * CLI and slash-command surfaces use, so the tool transcript matches them
 * byte-for-byte.
 *
 * Risk classification: `dangerous`. Retract permanently removes user data
 * (memory/knowledge/inbox files) or moves a task to `data/tasks/dropped/`.
 * Tool guardrails route this through the standard approval/autonomy gates
 * for destructive actions.
 */
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolDef } from "#core/modules/module-types.js";
import { localDestructiveEffect } from "#core/tools/effect.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import type { RetractRequest, RetractTarget } from "./client.js";
import { renderRetractResultPlain } from "./render.js";
import { RETRACT_TARGET_ORDER, type RetractProvider } from "./retract-types.js";

const RETRACT_TARGETS: ReadonlyArray<RetractTarget> = RETRACT_TARGET_ORDER;

export const retractTool: KotaTool = {
  name: "retract",
  description:
    "Remove or supersede a prior cross-store capture by id (memory, knowledge, tasks, inbox). " +
    "Use this when the user explicitly contradicts or corrects a fact you previously captured, " +
    "instead of appending a contradicting note. Specify the destination store and the typed " +
    "identifier — memory/tasks use `id`, knowledge uses `slug`, inbox uses `path`. The seam " +
    "never guesses a target. Tasks route through the state machine into data/tasks/dropped/; " +
    "they are not deleted.",
  input_schema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        enum: [...RETRACT_TARGETS],
        description: "Destination store. Required.",
      },
      id: {
        type: "string",
        description:
          "Memory id (target=memory) or task id (target=tasks). Mutually exclusive with `slug` / `path`.",
      },
      slug: {
        type: "string",
        description:
          "Knowledge slug (target=knowledge only). Mutually exclusive with `id` / `path`.",
      },
      path: {
        type: "string",
        description:
          "Repo-relative inbox path (target=inbox only, e.g. data/inbox/note-foo.md). Mutually exclusive with `id` / `slug`.",
      },
    },
    required: ["target"],
  },
};

export function createRetractToolRunner(
  resolveProvider: () => RetractProvider,
): (input: Record<string, unknown>) => Promise<ToolResult> {
  return async (input) => {
    if (
      typeof input.target !== "string" ||
      !RETRACT_TARGETS.includes(input.target as RetractTarget)
    ) {
      return {
        content: `Retract failed: \`target\` must be one of ${RETRACT_TARGETS.join(", ")}.`,
        is_error: true,
      };
    }
    const target = input.target as RetractTarget;
    const id = input.id;
    const slug = input.slug;
    const path = input.path;

    let request: RetractRequest;
    switch (target) {
      case "memory":
        if (slug !== undefined || path !== undefined) {
          return {
            content:
              "Retract failed: memory target takes `id` only (no `slug` / `path`).",
            is_error: true,
          };
        }
        if (typeof id !== "string" || id === "") {
          return {
            content: "Retract failed: memory target requires `id`.",
            is_error: true,
          };
        }
        request = { target: "memory", id };
        break;
      case "knowledge":
        if (id !== undefined || path !== undefined) {
          return {
            content:
              "Retract failed: knowledge target takes `slug` only (no `id` / `path`).",
            is_error: true,
          };
        }
        if (typeof slug !== "string" || slug === "") {
          return {
            content: "Retract failed: knowledge target requires `slug`.",
            is_error: true,
          };
        }
        request = { target: "knowledge", slug };
        break;
      case "tasks":
        if (slug !== undefined || path !== undefined) {
          return {
            content:
              "Retract failed: tasks target takes `id` only (no `slug` / `path`).",
            is_error: true,
          };
        }
        if (typeof id !== "string" || id === "") {
          return {
            content: "Retract failed: tasks target requires `id`.",
            is_error: true,
          };
        }
        request = { target: "tasks", id };
        break;
      case "inbox":
        if (id !== undefined || slug !== undefined) {
          return {
            content:
              "Retract failed: inbox target takes `path` only (no `id` / `slug`).",
            is_error: true,
          };
        }
        if (typeof path !== "string" || path === "") {
          return {
            content: "Retract failed: inbox target requires `path`.",
            is_error: true,
          };
        }
        request = { target: "inbox", path };
        break;
    }

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
    effect: localDestructiveEffect(),
  };
}
