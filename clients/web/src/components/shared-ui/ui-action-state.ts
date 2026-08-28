import type {
  UiAction,
  UiActionReadiness,
} from "../../../../conformance/ui-surface.generated";
import { assertNever } from "./ui-render-utils";

export function requiresConfirmation(action: UiAction): boolean {
  switch (action.confirmation.mode) {
    case "none":
      return false;
    case "required":
      return true;
    default:
      return assertNever(action.confirmation);
  }
}

export function describeReadiness(readiness: UiActionReadiness): {
  available: boolean;
  message: string | undefined;
} {
  switch (readiness.state) {
    case "ready":
      return { available: true, message: readiness.message };
    case "disabled":
      return {
        available: false,
        message: `${readiness.message} (${readiness.reason})`,
      };
    case "needs-setup":
      return {
        available: false,
        message: `${readiness.message} (${readiness.moduleName}/${readiness.requirementId})`,
      };
    default:
      return assertNever(readiness);
  }
}
