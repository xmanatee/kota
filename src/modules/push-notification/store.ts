/**
 * Push-token store. One JSON file at `<scopeRoot>/.kota/push-tokens.json`,
 * rewritten on every registration. Mobile clients call
 * `POST /push-tokens` once per launch; the file is the source of truth for
 * which devices receive Expo push deliveries.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonFileAtomic } from "#core/util/json-file.js";

export type PushTokenEntry = {
  token: string;
  deviceId: string;
  registeredAt: string;
};

export type PushTokenStore = {
  schemaVersion: 1;
  tokens: Record<string, PushTokenEntry>;
};

const PUSH_TOKENS_FILE = ".kota/push-tokens.json";

export function loadStore(scopeRoot: string): PushTokenStore {
  const path = join(scopeRoot, PUSH_TOKENS_FILE);
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (error) {
    if (isMissingFileError(error)) return emptyStore();
    throw new PushTokenStoreError(path, "read_failed", errorMessage(error));
  }
  try {
    const decoded = decodeStore(JSON.parse(raw) as unknown, path);
    if (decoded.migrated) saveStore(scopeRoot, decoded.store);
    return decoded.store;
  } catch (error) {
    if (error instanceof PushTokenStoreError) throw error;
    throw new PushTokenStoreError(path, "invalid_json", errorMessage(error));
  }
}

function saveStore(scopeRoot: string, store: PushTokenStore): void {
  writeJsonFileAtomic(join(scopeRoot, PUSH_TOKENS_FILE), store);
}

export class PushTokenStoreError extends Error {
  constructor(
    readonly path: string,
    readonly reason: "read_failed" | "invalid_json" | "unsupported_version" | "invalid_schema",
    message: string,
  ) {
    super(`Cannot load push-token store ${path}: ${message}`);
    this.name = "PushTokenStoreError";
  }
}

function decodeStore(value: unknown, path: string): { store: PushTokenStore; migrated: boolean } {
  if (!isRecord(value)) return invalidSchema(path, "store must be an object");
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) {
    throw new PushTokenStoreError(
      path,
      "unsupported_version",
      `unsupported schema version: ${String(value.schemaVersion)}`,
    );
  }
  if (!isRecord(value.tokens)) return invalidSchema(path, "tokens must be an object");
  const tokens: Record<string, PushTokenEntry> = {};
  for (const [deviceId, entry] of Object.entries(value.tokens)) {
    if (
      !isRecord(entry) ||
      typeof entry.token !== "string" ||
      typeof entry.deviceId !== "string" ||
      entry.deviceId !== deviceId ||
      typeof entry.registeredAt !== "string" ||
      !Number.isFinite(Date.parse(entry.registeredAt))
    ) {
      return invalidSchema(path, `token entry ${deviceId} is malformed`);
    }
    tokens[deviceId] = {
      token: entry.token,
      deviceId: entry.deviceId,
      registeredAt: new Date(entry.registeredAt).toISOString(),
    };
  }
  return { store: { schemaVersion: 1, tokens }, migrated: value.schemaVersion === undefined };
}

function emptyStore(): PushTokenStore {
  return { schemaVersion: 1, tokens: {} };
}

function invalidSchema(path: string, message: string): never {
  throw new PushTokenStoreError(path, "invalid_schema", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerPushToken(
  scopeRoot: string,
  deviceId: string,
  token: string,
): void {
  const store = loadStore(scopeRoot);
  store.tokens[deviceId] = {
    token,
    deviceId,
    registeredAt: new Date().toISOString(),
  };
  saveStore(scopeRoot, store);
}
