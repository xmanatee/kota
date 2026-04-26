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

export type DigestPushPayload = {
  title: string;
  body: string;
};

const EXPO_PUSH_API_URL = "https://exp.host/--/expo-server/push/send";
const DIGEST_BODY_PREVIEW_CHARS = 140;

type ExpoMessageData =
  | { screen: "approvals"; approvalId: string }
  | { screen: "digest" };

type ExpoMessage = {
  to: string;
  sound: "default";
  title: string;
  body: string;
  data: ExpoMessageData;
};

export async function sendPushNotifications(
  projectDir: string,
  payload: ApprovalPushPayload,
  log: (msg: string) => void,
): Promise<void> {
  const tokens = loadTokens(projectDir);
  if (tokens.length === 0) return;

  const { approvalId, tool, risk, source } = payload;
  const title = source ? `${source} — ${tool}` : `Approval: ${tool}`;
  const body = `Risk: ${risk}`;

  const messages: ExpoMessage[] = tokens.map((token) => ({
    to: token,
    sound: "default",
    title,
    body,
    data: { screen: "approvals", approvalId },
  }));

  await postMessages(messages, log);
}

export async function sendDigestPushNotifications(
  projectDir: string,
  payload: DigestPushPayload,
  log: (msg: string) => void,
): Promise<void> {
  const tokens = loadTokens(projectDir);
  if (tokens.length === 0) return;

  const body = previewBody(payload.body);

  const messages: ExpoMessage[] = tokens.map((token) => ({
    to: token,
    sound: "default",
    title: payload.title,
    body,
    data: { screen: "digest" },
  }));

  await postMessages(messages, log);
}

function loadTokens(projectDir: string): string[] {
  const store = loadStore(projectDir);
  return Object.values(store.tokens).map((entry) => entry.token);
}

function previewBody(rawBody: string): string {
  const firstLine = rawBody.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  const trimmed = firstLine.trim();
  if (trimmed.length <= DIGEST_BODY_PREVIEW_CHARS) return trimmed;
  return `${trimmed.slice(0, DIGEST_BODY_PREVIEW_CHARS - 1).trimEnd()}…`;
}

async function postMessages(
  messages: ExpoMessage[],
  log: (msg: string) => void,
): Promise<void> {
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
