import { vi } from "vitest";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import {
  buildScopeRegistryProjection,
  type DirectoryScope,
} from "#core/daemon/scope-registry.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { ModuleStorage } from "#core/modules/module-storage.js";
import {
  getProviderRegistry,
  initProviderRegistry,
} from "#core/modules/provider-registry.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import type { makeTelegramInteractiveChannel } from "./channels.js";
import { callTelegramApi } from "./client.js";
import type { loadTelegramModule } from "./notification-subscriptions.js";
import {
  SCOPE_A,
  SCOPE_B,
} from "./telegram-scope-daemon-test-support.integration.js";

export function registerDaemonScopeProvider(
  scopes: DirectoryScope[] = [SCOPE_A, SCOPE_B],
  defaultScope: DirectoryScope = SCOPE_A,
): void {
  const registry = getProviderRegistry() ?? initProviderRegistry();
  registry.register(DAEMON_SCOPE_PROVIDER_TYPE, "test", {
    getScopeRegistryProjection: () =>
      buildScopeRegistryProjection(defaultScope.scopeId, scopes),
    getActiveScopeId: () => null,
    resolveScopeRuntime: (scopeId) => {
      const requested = scopeId?.trim();
      const resolvedScopeId =
        requested && requested.length > 0
          ? requested
          : defaultScope.scopeId;
      const scope = scopes.find(
        (entry) => entry.scopeId === resolvedScopeId,
      );
      if (!scope) {
        return {
          ok: false,
          error: {
            error: "Unknown scope",
            reason: "unknown_scope",
            scopeId: resolvedScopeId,
          },
        };
      }
      return {
        ok: true,
        runtime: {
          scope,
          approvalQueue: {} as never,
          secretStore: {} as never,
          ownerDecisionStore: {} as never,
          ownerQuestionQueue: {} as never,
        },
      };
    },
  });
}

export function makeUpdate(updateId: number, text: string) {
  return {
    update_id: updateId,
    message: { chat: { id: 99 }, text },
  };
}

export function sendBodies(): Array<{
  chat_id: string | number;
  text: string;
}> {
  return vi.mocked(callTelegramApi).mock.calls
    .filter((call) => call[1] === "sendMessage")
    .map((call) => call[2] as { chat_id: string | number; text: string });
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

type TelegramScopePorts = Parameters<typeof makeTelegramInteractiveChannel>[0] &
  Parameters<typeof loadTelegramModule>[0];

export function makeTelegramPorts(
  bus: EventBus,
  client: KotaClient,
  storage: ModuleStorage,
): TelegramScopePorts {
  return {
    cwd: SCOPE_A.scopeRoot,
    verbose: false,
    config: {
      model: "claude-sonnet-4-6",
      modelProvider: { type: "anthropic", apiKey: "sk-test" },
    },
    storage,
    getModuleConfig: () => undefined,
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    getSecret: (key) => process.env[key] ?? null,
    events: makeStubEventProxy(bus),
    registerProvider: (token, provider) => {
      const registry = getProviderRegistry() ?? initProviderRegistry();
      registry.register(token, "telegram", provider);
    },
    getProvider: (token) => getProviderRegistry()?.get(token) ?? null,
    client,
  };
}
