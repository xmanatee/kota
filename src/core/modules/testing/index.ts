import type { ModuleContext } from "#core/modules/module-types.js";

/**
 * Adapt a real typed event bus to the module event port for focused tests of
 * event-producing components. Module lifecycle tests use `ModuleLoader`.
 */
export function makeStubEventProxy(
  bus: {
    emit: (event: string, payload: never) => void;
    on: (event: string, handler: never) => () => void;
    listenerCount: (event?: string) => number;
  },
): ModuleContext["events"] {
  const subscribe = (
    event: unknown,
    handler: (payload: never) => void,
  ): (() => void) => {
    const name =
      typeof event === "string" ? event : (event as { name: string }).name;
    return bus.on(name, handler as never);
  };
  const emit = (event: unknown, payload: Record<string, unknown>): void => {
    const name =
      typeof event === "string" ? event : (event as { name: string }).name;
    bus.emit(name, payload as never);
  };
  return {
    emit,
    subscribe,
    emitExternal: (event: string, payload: Record<string, unknown>) =>
      emit(event, payload),
    subscribeExternal: (
      event: string,
      handler: (payload: Record<string, unknown>) => void,
    ) => subscribe(event, handler as (payload: never) => void),
    listenerCount: (event?: string) => bus.listenerCount(event),
  } as unknown as ModuleContext["events"];
}
