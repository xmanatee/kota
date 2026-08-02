import { SETUP_ACTION_STATUSES } from "./constants.js";
import { invalidRequest } from "./results.js";
import type {
  ModuleSetupFailureResult,
  ModuleSetupPendingAction,
  ModuleSetupRequirementContribution,
} from "./types.js";
import { isLiteral } from "./validation.js";

export function validateCompletableSetupAction(
  action: ModuleSetupPendingAction,
  found: ModuleSetupRequirementContribution,
  nowMs: number,
): ModuleSetupFailureResult | null {
  if (!isLiteral(action.status, SETUP_ACTION_STATUSES)) {
    return invalidRequest(
      `Setup action "${action.actionId}" has invalid status "${String(action.status)}"`,
    );
  }
  if (action.status !== "pending") {
    return invalidRequest(`Setup action "${action.actionId}" is already ${action.status}`);
  }
  if (found.requirement.setup.mode !== "url") {
    return invalidRequest(`Setup action "${action.actionId}" does not target URL setup`);
  }
  const expiresAt = Date.parse(action.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    return invalidRequest(`Setup action "${action.actionId}" has invalid expiration`);
  }
  if (expiresAt <= nowMs) return invalidRequest(`Setup action "${action.actionId}" expired`);
  return null;
}
