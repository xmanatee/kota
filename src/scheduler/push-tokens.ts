import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type PushTokenEntry = { token: string; deviceId: string; registeredAt: string };
type PushTokenStore = { tokens: Record<string, PushTokenEntry> };

const PUSH_TOKENS_FILE = ".kota/push-tokens.json";

function loadStore(projectDir: string): PushTokenStore {
  try {
    const raw = readFileSync(join(projectDir, PUSH_TOKENS_FILE), "utf-8");
    return JSON.parse(raw) as PushTokenStore;
  } catch {
    return { tokens: {} };
  }
}

function saveStore(projectDir: string, store: PushTokenStore): void {
  writeFileSync(join(projectDir, PUSH_TOKENS_FILE), JSON.stringify(store, null, 2), "utf-8");
}

export function registerPushToken(projectDir: string, deviceId: string, token: string): void {
  const store = loadStore(projectDir);
  store.tokens[deviceId] = { token, deviceId, registeredAt: new Date().toISOString() };
  saveStore(projectDir, store);
}

export type ApprovalPushPayload = {
  approvalId: string;
  tool: string;
  risk: string;
  source: string;
};

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
    data: { approvalId },
  }));

  try {
    const res = await fetch("https://exp.host/--/expo-server/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      log(`[push] Expo Push API error: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    log(`[push] Failed to send push notifications: ${err instanceof Error ? err.message : String(err)}`);
  }
}
