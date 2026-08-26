import {
  type UiAction,
  type UiJsonValue,
  type UiSurfaceBundle,
  parseUiSurfaceBundle,
} from "../../../conformance/ui-surface.generated";
import { apiDecoded, apiJson, withScope } from "./client-runtime";

export type UiActionExecutionResult =
  | { ok: true; message: string }
  | { ok: false; reason: string; message: string };

function parseUiActionExecutionResult(raw: unknown): UiActionExecutionResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid UI action result: expected an object.");
  }
  const result = raw as {
    ok?: unknown;
    reason?: unknown;
    message?: unknown;
  };
  if (result.ok === true && typeof result.message === "string") {
    return { ok: true, message: result.message };
  }
  if (
    result.ok === false &&
    typeof result.reason === "string" &&
    typeof result.message === "string"
  ) {
    return {
      ok: false,
      reason: result.reason,
      message: result.message,
    };
  }
  throw new Error("Invalid UI action result: unknown result arm.");
}

export const uiApi = {
  getUiSurfaces: (scopeId: string): Promise<UiSurfaceBundle> =>
    apiDecoded(withScope("/ui/surfaces", scopeId), parseUiSurfaceBundle),
  executeUiAction: async (
    action: UiAction,
    parameters?: UiJsonValue,
  ): Promise<UiActionExecutionResult> => {
    const raw = await apiJson<unknown>("/ui/actions/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeId: action.scopeId,
        surfaceId: action.surfaceId,
        actionId: action.actionId,
        ...(parameters === undefined ? {} : { parameters }),
      }),
    });
    return parseUiActionExecutionResult(raw);
  },
};
