import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { type TelegramChatProjectBinding, TelegramProjectSelection } from "./project-selection.js";

export type TelegramProjectRouting = {
  client: KotaClient;
  selection: TelegramProjectSelection;
};

export type TelegramProjectSource = Pick<KotaClient["projects"], "list">;

export function hasProjectRoutingClient(client: KotaClient): boolean {
  return typeof client.forProject === "function" &&
    typeof client.projects?.list === "function";
}

// Channels are contributed before the daemon publishes a daemon-control client.
// Once the daemon is constructing the channel, its in-process registry provider
// is the authoritative project-list source.
export function resolveDaemonProjectSource(
  ctx: ModuleContext,
): TelegramProjectSource | undefined {
  const projectScope = ctx.getProvider(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE);
  if (!projectScope) return undefined;
  return {
    list: async () => {
      const projection = projectScope.getProjectRegistryProjection();
      return {
        ok: true as const,
        projects: projection.projects,
        defaultProjectId: projection.defaultProjectId,
        activeProjectId: projectScope.getActiveProjectId(),
      };
    },
  };
}

export function resolveTelegramProjectRouting(
  ctx: ModuleContext,
  chatProjectBindings: TelegramChatProjectBinding[],
): TelegramProjectRouting | undefined {
  const client = tryResolveTelegramClient(ctx);
  if (!client) return undefined;
  if (!hasProjectRoutingClient(client)) return undefined;
  const projectSource = resolveDaemonProjectSource(ctx);
  return {
    client,
    selection: new TelegramProjectSelection(
      client,
      ctx.storage,
      chatProjectBindings,
      projectSource ? { projectSource } : undefined,
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
