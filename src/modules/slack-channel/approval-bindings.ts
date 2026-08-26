import type { ModuleStorage } from "#core/modules/module-storage.js";

const STORAGE_KEY = "approval-bindings";

export type SlackApprovalBinding = {
  scopeId: string;
  approvalId: string;
  reviewDigest: string;
  channelId: string;
  messageTs: string;
};

type StoredBindings = {
  schemaVersion: 1;
  bindings: SlackApprovalBinding[];
};

function bindingKey(channelId: string, messageTs: string): string {
  return `${channelId}\u0000${messageTs}`;
}

function decodeBinding(value: unknown): SlackApprovalBinding | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.scopeId !== "string" ||
    typeof row.approvalId !== "string" ||
    typeof row.reviewDigest !== "string" ||
    typeof row.channelId !== "string" ||
    typeof row.messageTs !== "string"
  ) return null;
  return {
    scopeId: row.scopeId,
    approvalId: row.approvalId,
    reviewDigest: row.reviewDigest,
    channelId: row.channelId,
    messageTs: row.messageTs,
  };
}

function decodeStoredBindings(value: unknown): SlackApprovalBinding[] {
  if (value === undefined) return [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const stored = value as Record<string, unknown>;
  if (stored.schemaVersion !== 1 || !Array.isArray(stored.bindings)) return [];
  return stored.bindings.flatMap((entry) => {
    const binding = decodeBinding(entry);
    return binding ? [binding] : [];
  });
}

export class SlackApprovalBindingStore {
  private readonly bindings = new Map<string, SlackApprovalBinding>();

  constructor(private readonly storage?: ModuleStorage) {
    for (const binding of decodeStoredBindings(storage?.getJSON(STORAGE_KEY))) {
      this.bindings.set(bindingKey(binding.channelId, binding.messageTs), binding);
    }
  }

  set(binding: SlackApprovalBinding): void {
    this.bindings.set(bindingKey(binding.channelId, binding.messageTs), binding);
    this.persist();
  }

  get(channelId: string, messageTs: string): SlackApprovalBinding | null {
    return this.bindings.get(bindingKey(channelId, messageTs)) ?? null;
  }

  delete(channelId: string, messageTs: string): void {
    if (!this.bindings.delete(bindingKey(channelId, messageTs))) return;
    this.persist();
  }

  private persist(): void {
    if (!this.storage) return;
    const value: StoredBindings = {
      schemaVersion: 1,
      bindings: [...this.bindings.values()],
    };
    this.storage.setJSON(STORAGE_KEY, value);
  }
}
