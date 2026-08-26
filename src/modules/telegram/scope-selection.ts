import type { DirectoryScope } from "#core/daemon/scope-registry.js";
import type { ModuleStorage } from "#core/modules/module-storage.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";

export type TelegramChatScopeBinding = {
  chatId: number;
  scopeId: string;
};

type StoredChatScopeSelections = {
  selections: { chatId: string; scopeId: string }[];
};

export type TelegramScopeResolution =
  | { ok: true; scope: DirectoryScope; showScopeLabels: boolean }
  | { ok: false; message: string };

export type TelegramScopeSwitchResult =
  | {
      ok: true;
      scope: DirectoryScope;
      changed: boolean;
      showScopeLabels: boolean;
      message: string;
    }
  | { ok: false; message: string };

type TelegramScopeView =
  | {
      ok: true;
      scopes: DirectoryScope[];
      byId: Map<string, DirectoryScope>;
      showScopeLabels: boolean;
    }
  | { ok: false; message: string };

type TelegramScopeSource = Pick<KotaClient["scopes"], "list">;

type TelegramScopeSelectionOptions = {
  scopeSource?: TelegramScopeSource;
};

const STORAGE_KEY = "chat-scope-selection";

function chatKey(chatId: number): string {
  return String(chatId);
}

function formatScope(scope: DirectoryScope): string {
  return `${scope.displayName} (${scope.scopeId})`;
}

function renderScopeList(scopes: DirectoryScope[]): string {
  if (scopes.length === 1) {
    return `This daemon hosts one scope: ${formatScope(scopes[0]!)}. /scope is only needed when multiple scopes are hosted.`;
  }
  return [
    "Scopes hosted by this daemon:",
    ...scopes.map((scope) => `- ${formatScope(scope)}`),
    "",
    "Send /scope <id> to switch this chat.",
  ].join("\n");
}

function buildScopeBindingMap(bindings: TelegramChatScopeBinding[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const binding of bindings) {
    const key = chatKey(binding.chatId);
    const existing = map.get(key);
    if (existing !== undefined && existing !== binding.scopeId) {
      throw new Error(`Duplicate Telegram scope binding for chat ${key}`);
    }
    map.set(key, binding.scopeId);
  }
  return map;
}

export class TelegramScopeSelection {
  private readonly defaults: Map<string, string>;
  private readonly scopeSource: TelegramScopeSource;

  constructor(
    client: KotaClient,
    private readonly storage: ModuleStorage,
    bindings: TelegramChatScopeBinding[],
    options?: TelegramScopeSelectionOptions,
  ) {
    this.defaults = buildScopeBindingMap(bindings);
    this.scopeSource = options?.scopeSource ?? client.scopes;
  }

  async resolveChat(chatId: number): Promise<TelegramScopeResolution> {
    const view = await this.scopeView();
    if (!view.ok) return view;
    if (view.scopes.length === 1) {
      return {
        ok: true,
        scope: view.scopes[0]!,
        showScopeLabels: view.showScopeLabels,
      };
    }

    const selected = this.readSelections().get(chatKey(chatId)) ?? this.defaults.get(chatKey(chatId));
    if (selected === undefined) {
      return {
        ok: false,
        message:
          "This Telegram chat is not bound to a KOTA scope. Send /scope to list scopes, then /scope <id> to choose one.",
      };
    }
    const scope = view.byId.get(selected);
    if (!scope) {
      return {
        ok: false,
        message:
          `Telegram scope "${selected}" is not hosted by this daemon. Send /scope to choose a valid scope.`,
      };
    }
    return { ok: true, scope, showScopeLabels: view.showScopeLabels };
  }

  async switchChat(chatId: number, scopeId: string): Promise<TelegramScopeSwitchResult> {
    const view = await this.scopeView();
    if (!view.ok) return view;
    const trimmed = scopeId.trim();
    if (trimmed.length === 0) {
      return { ok: false, message: renderScopeList(view.scopes) };
    }
    if (view.scopes.length === 1) {
      return {
        ok: true,
        scope: view.scopes[0]!,
        changed: false,
        showScopeLabels: view.showScopeLabels,
        message: renderScopeList(view.scopes),
      };
    }
    const next = view.byId.get(trimmed);
    if (!next) {
      return {
        ok: false,
        message:
          `Unknown scope "${trimmed}".\n\n${renderScopeList(view.scopes)}`,
      };
    }
    const key = chatKey(chatId);
    const previous = this.readSelections().get(key) ?? this.defaults.get(key);
    const selections = this.readSelections();
    selections.set(key, next.scopeId);
    this.writeSelections(selections);
    return {
      ok: true,
      scope: next,
      changed: previous !== next.scopeId,
      showScopeLabels: view.showScopeLabels,
      message: `Telegram chat is now using ${formatScope(next)}.`,
    };
  }

  async renderScopeLabelPrefix(scopeId: string): Promise<string> {
    const view = await this.scopeView();
    if (!view.ok || !view.showScopeLabels) return "";
    const scope = view.byId.get(scopeId);
    return `[${scope?.displayName ?? scopeId}] `;
  }

  private async scopeView(): Promise<TelegramScopeView> {
    const result = await this.scopeSource.list();
    if (!result.ok) {
      return {
        ok: false,
        message: "Scope selection requires a running daemon scope registry.",
      };
    }
    return {
      ok: true,
      scopes: result.scopes,
      byId: new Map(result.scopes.map((scope) => [scope.scopeId, scope])),
      showScopeLabels: result.scopes.length > 1,
    };
  }

  private readSelections(): Map<string, string> {
    const stored = this.storage.getJSON<StoredChatScopeSelections>(STORAGE_KEY);
    const selections = new Map<string, string>();
    if (!stored || !Array.isArray(stored.selections)) return selections;
    for (const entry of stored.selections) {
      if (typeof entry.chatId === "string" && typeof entry.scopeId === "string") {
        selections.set(entry.chatId, entry.scopeId);
      }
    }
    return selections;
  }

  private writeSelections(selections: Map<string, string>): void {
    this.storage.setJSON(STORAGE_KEY, {
      selections: [...selections.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([chatId, scopeId]) => ({ chatId, scopeId })),
    } satisfies StoredChatScopeSelections);
  }
}
