import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import type {
  SlackEventsApiPayload,
  SlackInteractivePayload,
  SlackMessageEvent,
} from "./client.js";

export type SlackInteractiveAdmissionPolicy = {
  workspaceId?: string;
  allowedUserIds: readonly string[];
};

export type SlackAdmissionResult =
  | { admitted: true }
  | {
      admitted: false;
      reason:
        | "workspace-not-configured"
        | "workspace-mismatch"
        | "user-not-allowed"
        | "message-not-direct";
    };

export function reportSlackAdmission(
  result: SlackAdmissionResult,
  input: "message" | "callback",
): boolean {
  if (result.admitted) return true;
  printTerminalDiagnostic(
    `[kota-slack] Rejected interactive ${input} (${result.reason})`,
    "warn",
  );
  return false;
}

function admitWorkspaceAndUser(
  policy: SlackInteractiveAdmissionPolicy,
  workspaceId: string | undefined,
  userId: string,
): SlackAdmissionResult {
  if (!policy.workspaceId) {
    return { admitted: false, reason: "workspace-not-configured" };
  }
  if (workspaceId !== policy.workspaceId) {
    return { admitted: false, reason: "workspace-mismatch" };
  }
  if (!policy.allowedUserIds.includes(userId)) {
    return { admitted: false, reason: "user-not-allowed" };
  }
  return { admitted: true };
}

export function admitSlackMessage(
  policy: SlackInteractiveAdmissionPolicy,
  event: SlackMessageEvent,
  envelope: SlackEventsApiPayload,
): SlackAdmissionResult {
  const admission = admitWorkspaceAndUser(
    policy,
    envelope.team_id,
    event.user ?? "",
  );
  if (!admission.admitted) return admission;
  if (event.channel_type !== "im") {
    return { admitted: false, reason: "message-not-direct" };
  }
  return { admitted: true };
}

export function admitSlackInteraction(
  policy: SlackInteractiveAdmissionPolicy,
  payload: SlackInteractivePayload,
): SlackAdmissionResult {
  return admitWorkspaceAndUser(
    policy,
    payload.team?.id,
    payload.user.id,
  );
}
