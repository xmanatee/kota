import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import { TelegramScopeSelection } from "./scope-selection.js";

const scopes = [
  { scopeId: "scope-a", scopeRoot: "/tmp/scope-a", displayName: "Scope A" },
  { scopeId: "scope-b", scopeRoot: "/tmp/scope-b", displayName: "Scope B" },
];

function makeClient(): KotaClient {
  return {
    scopes: {
      list: vi.fn(async () => ({
        ok: true as const,
        scopes,
        defaultScopeId: "scope-a",
        activeScopeId: null,
      })),
      use: vi.fn(),
    },
  } as unknown as KotaClient;
}

describe("TelegramScopeSelection", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function storage(): ModuleStorage {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-scope-selection-"));
    return new ModuleStorage(dir, "telegram");
  }

  it("uses configured chat bindings to resolve a scope on multi-scope daemons", async () => {
    const selection = new TelegramScopeSelection(
      makeClient(),
      storage(),
      [{ chatId: 99, scopeId: "scope-b" }],
    );

    const resolved = await selection.resolveChat(99);

    expect(resolved).toEqual({
      ok: true,
      scope: scopes[1],
      showScopeLabels: true,
    });
  });

  it("stores per-chat /scope overrides without mutating the global scope selector", async () => {
    const client = makeClient();
    const selection = new TelegramScopeSelection(
      client,
      storage(),
      [{ chatId: 99, scopeId: "scope-a" }],
    );

    const switched = await selection.switchChat(99, "scope-b");
    const resolved = await selection.resolveChat(99);

    expect(switched.ok).toBe(true);
    expect(resolved).toEqual({
      ok: true,
      scope: scopes[1],
      showScopeLabels: true,
    });
    expect(client.scopes.use).not.toHaveBeenCalled();
  });

  it("can read scopes from a daemon source when the captured client is local", async () => {
    const client = {
      scopes: {
        list: vi.fn(async () => ({ ok: false as const, reason: "daemon_required" as const })),
        use: vi.fn(),
      },
    } as unknown as KotaClient;
    const scopeSource = {
      list: vi.fn(async () => ({
        ok: true as const,
        scopes,
        defaultScopeId: "scope-a",
        activeScopeId: null,
      })),
    };
    const selection = new TelegramScopeSelection(client, storage(), [], {
      scopeSource,
    });

    const switched = await selection.switchChat(99, "scope-b");
    const resolved = await selection.resolveChat(99);

    expect(switched.ok).toBe(true);
    expect(resolved).toEqual({
      ok: true,
      scope: scopes[1],
      showScopeLabels: true,
    });
    expect(scopeSource.list).toHaveBeenCalled();
    expect(client.scopes.list).not.toHaveBeenCalled();
  });

  it("returns a loud unbound-chat message on multi-scope daemons", async () => {
    const selection = new TelegramScopeSelection(makeClient(), storage(), []);

    const resolved = await selection.resolveChat(99);

    expect(resolved).toEqual({
      ok: false,
      message:
        "This Telegram chat is not bound to a KOTA scope. Send /scope to list scopes, then /scope <id> to choose one.",
    });
  });

  it("renders labels only when more than one scope is hosted", async () => {
    const singleClient = {
      scopes: {
        list: vi.fn(async () => ({
          ok: true as const,
          scopes: [scopes[0]!],
          defaultScopeId: "scope-a",
          activeScopeId: null,
        })),
        use: vi.fn(),
      },
    } as unknown as KotaClient;

    expect(
      await new TelegramScopeSelection(makeClient(), storage(), [])
        .renderScopeLabelPrefix("scope-b"),
    ).toBe("[Scope B] ");
    expect(
      await new TelegramScopeSelection(singleClient, storage(), [])
        .renderScopeLabelPrefix("scope-a"),
    ).toBe("");
  });
});
