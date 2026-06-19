import type { ModuleSetupFailureResult } from "./types.js";

export function notFound(moduleName: string, requirementId: string): ModuleSetupFailureResult {
  return {
    ok: false,
    reason: "not_found",
    message: `Setup requirement "${moduleName}/${requirementId}" not found`,
  };
}

export function invalidRequest(message: string): ModuleSetupFailureResult {
  return { ok: false, reason: "invalid_request", message };
}

export function storeError(message: string): ModuleSetupFailureResult {
  return {
    ok: false,
    reason: "store_error",
    message,
  };
}
