/**
 * Typed module event declarations.
 *
 * A `ModuleEventDef` is the typed handle a module exports for an event it
 * owns. The phantom `__payload` carries the payload type at compile time so
 * `ctx.events.emit(decl, payload)` and `ctx.events.subscribe(decl, handler)`
 * are checked against the declared shape. The `fields` array records the
 * declared payload field names at runtime so workflow trigger validation can
 * reject filters that reference nonexistent fields. The `scope` field
 * separates scope-scoped events (whose payloads carry `scopeId` plus the
 * directory-scope compatibility `projectId`) from daemon-wide events
 * (registry change, daemon lifecycle, session-bound
 * tool-call events that stay daemon-default until session-projectId
 * attribution lands).
 *
 * Module-owned events live next to the module that emits them; consumers in
 * other modules import the declaration to get a typed subscriber. Truly
 * external events (inbound webhook surfaces, dynamic third-party event names)
 * use the visibly unsafe `emitExternal` / `subscribeExternal` escape hatch on
 * `ctx.events` and validate at the boundary.
 *
 * Module authors declare the scope explicitly through the helper they choose:
 * - {@link defineProjectScopedModuleEvent} for directory-scope events.
 * - {@link defineDaemonWideModuleEvent} for daemon-wide events.
 *
 * The lower-level {@link defineModuleEvent} primitive both helpers wrap takes
 * `scope` as a required parameter so no module event can be declared without
 * picking one or the other.
 */

import type { BusEnvelope } from "./event-bus-types.js";

/**
 * Scope discriminator for {@link ModuleEventDef}. `project` is retained as
 * the compatibility discriminator for directory-scope events: payloads carry
 * canonical `scopeId` plus compatibility `projectId`, and the runtime rejects
 * emits that lack both. `daemon` events are delivered without scope
 * attribution.
 */
export type ModuleEventScope = "project" | "daemon";

export type ModuleEventDef<TPayload = unknown> = {
  readonly name: string;
  readonly fields: ReadonlyArray<string>;
  readonly scope: ModuleEventScope;
  /**
   * Phantom marker carrying the payload type for inference. Stored as a
   * function return so `ModuleEventDef<TSpecific>` is assignable to the
   * default `ModuleEventDef<unknown>` (covariant). Always undefined at
   * runtime. The `defineModuleEvent` helper enforces that `TPayload` is a
   * record-shaped object at construction time.
   */
  readonly __payload?: () => TPayload;
};

export function defineModuleEvent<TPayload extends Record<string, unknown>>(
  name: string,
  fields: ReadonlyArray<keyof TPayload & string>,
  scope: ModuleEventScope,
): ModuleEventDef<TPayload> {
  return { name, fields, scope };
}

/**
 * Declare a daemon-wide module event. Use for module-owned events that have
 * no project attribution (daemon-process lifecycle, registry/loader signals)
 * or that are still session-bound at the boundary and will migrate to a
 * project-scoped declaration once session-projectId attribution lands.
 *
 * Daemon-wide module events bypass the `ProjectScopedEventBus` filter — every
 * subscriber receives every emit. Document the rationale next to the
 * declaration so a future migration knows what changes.
 */
export function defineDaemonWideModuleEvent<TPayload extends Record<string, unknown>>(
  name: string,
  fields: ReadonlyArray<keyof TPayload & string>,
): ModuleEventDef<TPayload> {
  return defineModuleEvent<TPayload>(name, fields, "daemon");
}

/**
 * Throws if `def` is project-scoped and `payload` does not carry a non-empty
 * scope selector. Used by the lowest-level emit paths
 * (`EventBus.emit(def, payload)`, `ModuleEventProxy.emit(def, payload)`,
 * `tryEmit(def, payload)`) so callers cannot accidentally leak a
 * project-scoped module event onto the bus without identity. Callers that
 * still provide only `projectId` remain valid compatibility callers; callers
 * that provide both selectors must make them agree.
 */
export function assertModuleEventPayloadScope(
  def: ModuleEventDef,
  payload: Record<string, unknown>,
): void {
  if (def.scope !== "project") return;
  const scopeId =
    typeof payload.scopeId === "string" && payload.scopeId.length > 0
      ? payload.scopeId
      : undefined;
  const projectId =
    typeof payload.projectId === "string" && payload.projectId.length > 0
      ? payload.projectId
      : undefined;
  if (!scopeId && !projectId) {
    throw new Error(
      `Module event "${def.name}" is project-scoped; emit payload must include a non-empty string scopeId or projectId. ` +
        `Emit through a ProjectScopedEventBus to inject scope attribution automatically.`,
    );
  }
  if (scopeId && projectId && scopeId !== projectId) {
    throw new Error(
      `Module event "${def.name}" has conflicting scope selectors: scopeId=${scopeId}, projectId=${projectId}.`,
    );
  }
}

export type ModuleEventPayload<E> = E extends ModuleEventDef<infer P> ? P : never;

export type ModuleEventRegistration = {
  readonly module: string;
  readonly fields: ReadonlyArray<string>;
};

class ModuleEventRegistry {
  private events = new Map<string, ModuleEventRegistration>();

  register(moduleName: string, def: ModuleEventDef): void {
    const prior = this.events.get(def.name);
    if (prior && prior.module !== moduleName) {
      throw new Error(
        `Module event "${def.name}" already declared by module "${prior.module}"; ` +
          `module "${moduleName}" cannot redeclare it. Each module event has a single owner.`,
      );
    }
    this.events.set(def.name, { module: moduleName, fields: def.fields });
  }

  unregisterModule(moduleName: string): void {
    for (const [name, reg] of this.events) {
      if (reg.module === moduleName) this.events.delete(name);
    }
  }

  get(name: string): ModuleEventRegistration | undefined {
    return this.events.get(name);
  }

  has(name: string): boolean {
    return this.events.has(name);
  }

  all(): ReadonlyMap<string, ModuleEventRegistration> {
    return this.events;
  }

  clear(): void {
    this.events.clear();
  }
}

export type { ModuleEventRegistry };

let instance: ModuleEventRegistry | undefined;

export function initModuleEventRegistry(): ModuleEventRegistry {
  if (!instance) instance = new ModuleEventRegistry();
  return instance;
}

export function getModuleEventRegistry(): ModuleEventRegistry | null {
  return instance ?? null;
}

export function resetModuleEventRegistry(): void {
  if (instance) instance.clear();
  instance = undefined;
}

export type WildcardEventHandler = (envelope: BusEnvelope) => void;
