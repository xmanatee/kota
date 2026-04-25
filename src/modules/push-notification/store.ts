/**
 * Push-token store. One JSON file at `<projectDir>/.kota/push-tokens.json`,
 * rewritten on every registration. Mobile clients call
 * `POST /push-tokens` once per launch; the file is the source of truth for
 * which devices receive Expo push deliveries.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PushTokenEntry = {
  token: string;
  deviceId: string;
  registeredAt: string;
};

export type PushTokenStore = { tokens: Record<string, PushTokenEntry> };

const PUSH_TOKENS_FILE = ".kota/push-tokens.json";

export function loadStore(projectDir: string): PushTokenStore {
  try {
    const raw = readFileSync(join(projectDir, PUSH_TOKENS_FILE), "utf-8");
    return JSON.parse(raw) as PushTokenStore;
  } catch {
    return { tokens: {} };
  }
}

function saveStore(projectDir: string, store: PushTokenStore): void {
  writeFileSync(
    join(projectDir, PUSH_TOKENS_FILE),
    JSON.stringify(store, null, 2),
    "utf-8",
  );
}

export function registerPushToken(
  projectDir: string,
  deviceId: string,
  token: string,
): void {
  const store = loadStore(projectDir);
  store.tokens[deviceId] = {
    token,
    deviceId,
    registeredAt: new Date().toISOString(),
  };
  saveStore(projectDir, store);
}
