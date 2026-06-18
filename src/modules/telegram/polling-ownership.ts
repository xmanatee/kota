import { createHash } from "node:crypto";

export type TelegramPollingOwner = {
  owner: string;
  source: string;
};

export class TelegramPollingOwnershipError extends Error {
  constructor(
    readonly requestedOwner: TelegramPollingOwner,
    readonly activeOwner: TelegramPollingOwner,
  ) {
    super(
      `Telegram getUpdates owner "${requestedOwner.owner}" (${requestedOwner.source}) cannot start because ` +
        `"${activeOwner.owner}" (${activeOwner.source}) already owns this bot token. ` +
        "Stop the existing Telegram poller before starting another.",
    );
    this.name = "TelegramPollingOwnershipError";
  }
}

const activeOwners = new Map<string, TelegramPollingOwner>();

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function acquireTelegramPollingOwner(
  token: string,
  owner: TelegramPollingOwner,
): () => void {
  const key = tokenKey(token);
  const active = activeOwners.get(key);
  if (active) {
    throw new TelegramPollingOwnershipError(owner, active);
  }
  activeOwners.set(key, owner);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (activeOwners.get(key) === owner) activeOwners.delete(key);
  };
}

export function resetTelegramPollingOwnersForTests(): void {
  activeOwners.clear();
}
