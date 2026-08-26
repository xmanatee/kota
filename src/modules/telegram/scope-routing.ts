import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import { directoryScopesFromProjection } from "#core/daemon/scope-registry.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import { type TelegramChatScopeBinding, TelegramScopeSelection } from "./scope-selection.js";

export type TelegramScopeRouting = {
  client: KotaClient;
  selection: TelegramScopeSelection;
};

export type TelegramScopeSource = Pick<KotaClient["scopes"], "list">;

export function hasScopeRoutingClient(client: KotaClient): boolean {
  return typeof client.forScope === "function" &&
    typeof client.scopes?.list === "function";
}

// Channels are contributed before the daemon publishes a daemon-control client.
// Once the daemon is constructing the channel, its in-process registry provider
// is the authoritative scope-list source.
export function resolveDaemonScopeSource(
  ctx: ModuleContext,
): TelegramScopeSource | undefined {
  const scopeProvider = ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE);
  if (!scopeProvider) return undefined;
  return {
    list: async () => {
      const projection = scopeProvider.getScopeRegistryProjection();
      return {
        ok: true as const,
        scopes: directoryScopesFromProjection(projection),
        defaultScopeId: projection.defaultScopeId,
        activeScopeId: scopeProvider.getActiveScopeId(),
      };
    },
  };
}

export function resolveTelegramScopeRouting(
  ctx: ModuleContext,
  chatScopeBindings: TelegramChatScopeBinding[],
): TelegramScopeRouting | undefined {
  const client = tryResolveTelegramClient(ctx);
  if (!client) return undefined;
  if (!hasScopeRoutingClient(client)) return undefined;
  const scopeSource = resolveDaemonScopeSource(ctx);
  return {
    client,
    selection: new TelegramScopeSelection(
      client,
      ctx.storage,
      chatScopeBindings,
      scopeSource ? { scopeSource } : undefined,
    ),
  };
}

export function tryResolveTelegramClient(ctx: ModuleContext): KotaClient | undefined {
  try {
    return ctx.client;
  } catch {
    return undefined;
  }
}
