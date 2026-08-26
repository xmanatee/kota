import type { IncomingMessage } from "node:http";
import {
  normalizeScopeSelector,
  ScopeSelectorConflictError,
} from "#core/server/scope-selector.js";
import { readBody } from "#core/server/session-pool.js";
import type { UiActionExecuteInput } from "./client.js";
import type { UiJsonValue } from "./operator-ui-types.js";

export type ParsedUiActionRequest =
  | { ok: true; input: UiActionExecuteInput }
  | { ok: false; message: string };

export async function parseUiActionRequest(
  req: IncomingMessage,
): Promise<ParsedUiActionRequest> {
  const parsedBody = await readBody(req).then(
    (body) => ({ ok: true as const, body }),
    (err) => ({ ok: false as const, err }),
  );
  if (!parsedBody.ok) {
    return {
      ok: false,
      message: parsedBody.err instanceof Error ? parsedBody.err.message : "Invalid JSON",
    };
  }
  const { body } = parsedBody;
  if (typeof body.surfaceId !== "string" || body.surfaceId.length === 0) {
    return { ok: false, message: "surfaceId must be a non-empty string." };
  }
  if (typeof body.actionId !== "string" || body.actionId.length === 0) {
    return { ok: false, message: "actionId must be a non-empty string." };
  }
  if (body.scopeId !== undefined && typeof body.scopeId !== "string") {
    return { ok: false, message: "scopeId must be a string." };
  }

  try {
    const selector = normalizeScopeSelector({
      scopeId: body.scopeId,
    });
    return {
      ok: true,
      input: {
        ...selector,
        surfaceId: body.surfaceId,
        actionId: body.actionId,
        parameters: body.parameters as UiJsonValue | undefined,
      },
    };
  } catch (err) {
    if (err instanceof ScopeSelectorConflictError) {
      return { ok: false, message: err.message };
    }
    throw err;
  }
}
