import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  DaemonClientHandlers,
  LocalClientHandlers,
} from "#core/server/kota-client.js";
import type { KotaModule, ModuleRuntimeContext } from "./module-types.js";

/**
 * Per-namespace assignment helper for the local client handler map.
 *
 * `Partial<LocalClientHandlers>[K] = LocalClientHandlers[K]` is sound for any
 * fixed `K`, but TypeScript widens the union when the key is loop-typed and
 * the value comes from an indexed read of the same map, leaving no single
 * concrete `K` to bind the assignment to. Narrowing the helper to a single
 * `K` per call expresses the per-key invariant that holds at runtime.
 */
function assignLocalClientHandler<K extends keyof LocalClientHandlers>(
  target: Partial<LocalClientHandlers>,
  namespace: K,
  impl: LocalClientHandlers[K],
): void {
  target[namespace] = impl;
}

/**
 * Per-namespace assignment helper for the daemon client handler map.
 * Mirrors {@link assignLocalClientHandler} for the daemon-side hook so the
 * loader can narrow the per-namespace assignment under TypeScript's
 * indexed-keyed-mapped-type rules.
 */
function assignDaemonClientHandler<K extends keyof DaemonClientHandlers>(
  target: Partial<DaemonClientHandlers>,
  namespace: K,
  impl: DaemonClientHandlers[K],
): void {
  target[namespace] = impl;
}

/**
 * A registered `daemonClient(link)` factory. The loader invokes the factory
 * lazily when the selector resolves to a daemon transport — the transport
 * does not exist at module load time.
 */
export type DaemonClientFactoryEntry = {
  moduleName: string;
  factory: (link: DaemonTransport) => Partial<DaemonClientHandlers>;
};

/**
 * Drain the module's `localClient(ctx)` partial into the loader-owned map.
 * Throws if another module has already claimed the same KotaClient namespace.
 */
export function collectLocalClientHandlers(
  target: Partial<LocalClientHandlers>,
  mod: KotaModule,
  ctx: ModuleRuntimeContext,
): void {
  if (!mod.localClient) return;
  const handlers = mod.localClient(ctx) as Partial<LocalClientHandlers>;
  for (const namespace of Object.keys(handlers) as (keyof LocalClientHandlers)[]) {
    const impl = handlers[namespace];
    if (!impl) continue;
    if (target[namespace]) {
      throw new Error(
        `Module "${mod.name}" tried to register a local client handler for ` +
          `"${namespace}" but one is already registered. Each KotaClient namespace has a single owner.`,
      );
    }
    assignLocalClientHandler(target, namespace, impl);
  }
}

/**
 * Register the module's `daemonClient(link)` factory. The factory is invoked
 * lazily by {@link assembleDaemonClientHandlers} once the selector resolves a
 * daemon transport — the transport does not exist during module load.
 */
export function collectDaemonClientFactory(
  factories: DaemonClientFactoryEntry[],
  mod: KotaModule,
): void {
  if (!mod.daemonClient) return;
  factories.push({ moduleName: mod.name, factory: mod.daemonClient });
}

/**
 * Build the contributed `Partial<DaemonClientHandlers>` map by invoking each
 * registered module's `daemonClient(link)` factory with the live transport.
 * Throws if two modules contribute the same namespace — each KotaClient
 * namespace has a single owner. The selector merges this on top of the core
 * stub before constructing `DaemonControlClient`.
 */
export function assembleDaemonClientHandlers(
  factories: readonly DaemonClientFactoryEntry[],
  transport: DaemonTransport,
): Partial<DaemonClientHandlers> {
  const handlers: Partial<DaemonClientHandlers> = {};
  for (const { moduleName, factory } of factories) {
    const partial = factory(transport) as Partial<DaemonClientHandlers>;
    for (const namespace of Object.keys(partial) as (keyof DaemonClientHandlers)[]) {
      const impl = partial[namespace];
      if (!impl) continue;
      if (handlers[namespace]) {
        throw new Error(
          `Module "${moduleName}" tried to register a daemon client handler for ` +
            `"${namespace}" but one is already registered. Each KotaClient namespace has a single owner.`,
        );
      }
      assignDaemonClientHandler(handlers, namespace, impl);
    }
  }
  return handlers;
}
