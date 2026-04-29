/**
 * Typed module event declarations.
 *
 * A `ModuleEventDef` is the typed handle a module exports for an event it
 * owns. The phantom `__payload` carries the payload type at compile time so
 * `ctx.events.emit(decl, payload)` and `ctx.events.subscribe(decl, handler)`
 * are checked against the declared shape. The `fields` array records the
 * declared payload field names at runtime so workflow trigger validation can
 * reject filters that reference nonexistent fields.
 *
 * Module-owned events live next to the module that emits them; consumers in
 * other modules import the declaration to get a typed subscriber. Truly
 * external events (inbound webhook surfaces, dynamic third-party event names)
 * use the visibly unsafe `emitExternal` / `subscribeExternal` escape hatch on
 * `ctx.events` and validate at the boundary.
 */

import type { BusEnvelope } from "./event-bus-types.js";

export type ModuleEventDef<TPayload = unknown> = {
  readonly name: string;
  readonly fields: ReadonlyArray<string>;
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
): ModuleEventDef<TPayload> {
  return { name, fields };
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
