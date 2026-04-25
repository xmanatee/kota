/**
 * Expo Push API delivery. Fire-and-forget by design: the mobile app uses
 * SSE / direct daemon polling as the reliable real-time path, and push
 * notifications are a best-effort wakeup hint for clients that are not
 * currently in the foreground. We deliberately do not reuse the
 * `notification` module's `postWithRetry` here — retrying an Expo Push
 * API failure would build a queue with no consumer and would extend the
 * approval.requested -> push delivery path past the "best-effort hint"
 * contract.
 */

import { loadStore } from "./store.js";

export type ApprovalPushPayload = {
  approvalId: string;
  tool: string;
  risk: string;
  source: string;
};

const EXPO_PUSH_API_URL = "https://exp.host/--/expo-server/push/send";

export async function sendPushNotifications(
  projectDir: string,
  payload: ApprovalPushPayload,
  log: (msg: string) => void,
): Promise<void> {
  const store = loadStore(projectDir);
  const entries = Object.values(store.tokens);
  if (entries.length === 0) return;

  const { approvalId, tool, risk, source } = payload;
  const title = source ? `${source} — ${tool}` : `Approval: ${tool}`;
  const body = `Risk: ${risk}`;

  const messages = entries.map((entry) => ({
    to: entry.token,
    sound: "default",
    title,
    body,
    data: { screen: "approvals", approvalId },
  }));

  try {
    const res = await fetch(EXPO_PUSH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      log(`[push] Expo Push API error: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    log(
      `[push] Failed to send push notifications: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
