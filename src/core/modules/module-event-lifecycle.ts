import type { EventBus } from "#core/events/event-bus.js";
import type { LoaderState } from "./module-loader-state.js";

export function resolveRuntimeModuleEventAuthority(
  isCommandsMode: boolean,
  bus: EventBus | null,
): EventBus | null {
  if (isCommandsMode) return bus;
  if (bus !== null) return bus;
  throw new Error(
    "Runtime ModuleLoader requires a bound runtime EventBus before module lifecycle execution",
  );
}

export function bindModuleEventBus(
  current: EventBus | null,
  next: EventBus,
  loadedModuleCount: number,
): EventBus {
  if (current === next) return next;
  if (loadedModuleCount > 0) {
    throw new Error("ModuleLoader EventBus must be bound before loading runtime modules");
  }
  if (current !== null) {
    throw new Error("ModuleLoader EventBus authority cannot be replaced after binding");
  }
  return next;
}

export function assertModuleEventBusAuthority(
  mode: "commands" | "runtime",
  current: EventBus | null,
  expected: EventBus,
): void {
  if (mode !== "runtime") {
    throw new Error("Daemon runtime requires a ModuleLoader in runtime lifecycle mode");
  }
  if (current === null) {
    throw new Error("Daemon runtime ModuleLoader has no bound EventBus authority");
  }
  if (current !== expected) {
    throw new Error("Daemon runtime ModuleLoader is bound to a different EventBus authority");
  }
}

export function trackModuleEventSubscription(
  state: LoaderState,
  moduleName: string | undefined,
  unsubscribe: () => void,
): () => void {
  let active = true;
  const ownedUnsubscribe = () => {
    if (!active) return;
    active = false;
    if (moduleName !== undefined) {
      const subscriptions = state.moduleEventSubscriptions.get(moduleName);
      subscriptions?.delete(ownedUnsubscribe);
      if (subscriptions?.size === 0) {
        state.moduleEventSubscriptions.delete(moduleName);
      }
    }
    unsubscribe();
  };
  if (moduleName !== undefined) {
    const subscriptions =
      state.moduleEventSubscriptions.get(moduleName) ?? new Set<() => void>();
    subscriptions.add(ownedUnsubscribe);
    state.moduleEventSubscriptions.set(moduleName, subscriptions);
  }
  return ownedUnsubscribe;
}

export function clearModuleEventSubscriptions(
  state: LoaderState,
  moduleName?: string,
): void {
  const entries = moduleName === undefined
    ? [...state.moduleEventSubscriptions.entries()]
    : [[moduleName, state.moduleEventSubscriptions.get(moduleName)] as const];
  for (const [owner, subscriptions] of entries) {
    if (!subscriptions) continue;
    for (const unsubscribe of [...subscriptions]) unsubscribe();
    state.moduleEventSubscriptions.delete(owner);
  }
}

export function clearNewModuleEventSubscriptions(
  state: LoaderState,
  ownersBeforeLoad: ReadonlySet<string>,
): void {
  for (const owner of [...state.moduleEventSubscriptions.keys()]) {
    if (!ownersBeforeLoad.has(owner)) clearModuleEventSubscriptions(state, owner);
  }
}
