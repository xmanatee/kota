import { spawn } from "node:child_process";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { assembleUiSurfaceBundle } from "#core/modules/module-ui-surfaces.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { normalizeScopeSelector, scopeSelectorQuery, selectedScopeSelectorId } from "#core/server/scope-selector.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type { UiClient } from "./client.js";
import { localDaemonStatus } from "./daemon-ops-operations.js";
import { waitForDaemonControlPlane } from "./daemon-readiness.js";
import type { UiActionExecutionResult, UiClientNamespaceExecutor, UiJsonValue, UiSurfaceBundle } from "./operator-ui.js";
import { daemonUiNamespaceExecutor, executeActionFromBundle } from "./ui-action-execution.js";
import {
  executeLocalSetupRoute,
  scopedUiActionPath,
  setupRouteBody,
} from "./ui-setup-route.js";

const DAEMON_CHILD_ENV = "KOTA_DAEMON_CHILD";
const DAEMON_SPAWN_TIMEOUT_MS = 2_000;
const DAEMON_START_READY_TIMEOUT_MS = 10_000;

export function buildSharedUiSurfaceBundle(
  ctx: ModuleContext,
  selector?: Parameters<UiClient["listSurfaces"]>[0],
): Promise<UiSurfaceBundle> {
  const normalized = normalizeScopeSelector(selector);
  let effectiveSelector = normalized;
  if (selectedScopeSelectorId(normalized) === undefined) {
    const scopeProvider = ctx.getProvider(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE);
    const scopeId = scopeProvider?.getActiveProjectId()
      ?? scopeProvider?.getProjectRegistryProjection().defaultProjectId;
    if (scopeId !== undefined) effectiveSelector = { scopeId };
  }
  return assembleUiSurfaceBundle(
    ctx.cwd,
    ctx.getContributedUiSurfaces(),
    { client: ctx.client, selector: effectiveSelector },
  );
}

function waitForChildSpawn(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`spawn was not confirmed within ${DAEMON_SPAWN_TIMEOUT_MS}ms`));
    }, DAEMON_SPAWN_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("spawn", onSpawn);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onSpawn = () => {
      cleanup();
      resolve();
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });
}

async function requestDetachedDaemonStart(
  projectDir: string,
): Promise<UiActionExecutionResult> {
  const current = localDaemonStatus({ projectDir });
  if (current.state === "running") {
    return { ok: true, message: `Daemon already running pid ${current.status.pid}.` };
  }
  const cliEntrypoint = process.argv[1];
  if (!cliEntrypoint) {
    return {
      ok: false,
      reason: "unavailable",
      message: "Unable to resolve the KOTA CLI entrypoint for daemon startup.",
    };
  }
  const env = withProtectedGitBareRepositoryEnv({ ...process.env });
  delete env[DAEMON_CHILD_ENV];
  try {
    const child = spawn(
      process.execPath,
      [...process.execArgv, cliEntrypoint, "daemon", "start", "--project-dir", projectDir],
      { cwd: projectDir, detached: true, env, stdio: "ignore" },
    );
    await waitForChildSpawn(child);
    child.unref();
    if (!await waitForDaemonControlPlane(projectDir)) {
      return {
        ok: false,
        reason: "unavailable",
        message: `Unable to start daemon: control plane was not ready within ${DAEMON_START_READY_TIMEOUT_MS}ms.`,
      };
    }
    return { ok: true, message: "Daemon started." };
  } catch (error) {
    return {
      ok: false,
      reason: "unavailable",
      message: `Unable to start daemon: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function localUiNamespaceExecutor(
  ctx: ModuleContext,
  scopeId: string,
): UiClientNamespaceExecutor {
  return async (operation) => {
    if (operation.namespace !== "daemonOps" || operation.method !== "start") return null;
    const localScopeIds = new Set([`dir:${ctx.cwd}`, deriveDirectoryScopeId(ctx.cwd)]);
    if (!localScopeIds.has(scopeId)) {
      return {
        ok: false,
        reason: "scope-unavailable",
        message: `Scope ${scopeId} is unavailable from the local project runtime.`,
      };
    }
    return requestDetachedDaemonStart(ctx.cwd);
  };
}

export function buildLocalUiClient(ctx: ModuleContext): UiClient {
  const listSurfaces = (selector?: Parameters<UiClient["listSurfaces"]>[0]) =>
    buildSharedUiSurfaceBundle(ctx, selector);
  return {
    listSurfaces,
    executeAction: async (input) => executeActionFromBundle({
      bundle: await listSurfaces(input),
      input,
      client: ctx.client,
      clientNamespaceExecutor: (action) => localUiNamespaceExecutor(ctx, action.scopeId),
      routeExecutor: (action, client) => {
        if (!client) throw new Error("Local UI action execution requires a scoped KotaClient.");
        return async (operation, parameters) => {
          if (operation.method === "GET" && operation.path === "/ui/surfaces") {
            await listSurfaces({ scopeId: action.scopeId });
            return { ok: true, message: "Shared UI surfaces refreshed." };
          }
          const setupResult = await executeLocalSetupRoute(client, operation, parameters);
          return setupResult ?? {
            ok: false,
            reason: "daemon_required",
            message: `${operation.method} ${operation.path} requires a running daemon.`,
          };
        };
      },
    }),
    watchEvents: async function* () {},
  };
}

export function buildUiDaemonHandler(link: DaemonTransport): UiClient {
  const listSurfaces = (selector?: Parameters<UiClient["listSurfaces"]>[0]) =>
    link.requestStrict<UiSurfaceBundle>("GET", `/ui/surfaces${scopeSelectorQuery(selector)}`);
  return {
    listSurfaces,
    executeAction: async (input) => {
      if (input.surfaceId === "setup" || input.actionId.startsWith("setup.")) {
        return link.requestStrict<UiActionExecutionResult>("POST", "/ui/actions/execute", input);
      }
      return executeActionFromBundle({
        bundle: await listSurfaces(input),
        input,
        clientNamespaceExecutor: (action) => daemonUiNamespaceExecutor(link, action.scopeId),
        routeExecutor: (action) => async (operation, parameters) => {
          const result = await link.request<UiJsonValue>(
            operation.method,
            scopedUiActionPath(operation.path, action.scopeId),
            setupRouteBody(operation, parameters),
            { timeoutMs: 10_000 },
          );
          return result === null
            ? {
                ok: false,
                reason: action.result.errors[0]?.reason ?? "unavailable",
                message: action.result.errors[0]?.message ?? "The daemon action is currently unavailable.",
              }
            : { ok: true, message: action.result.success.message };
        },
      });
    },
    watchEvents: async function* (input) {
      const allowed = input?.eventTypes !== undefined ? new Set(input.eventTypes) : null;
      for await (const event of link.events({ signal: input?.signal })) {
        if (allowed === null || allowed.has(event.type)) yield event;
      }
    },
  };
}
