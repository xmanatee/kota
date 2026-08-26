/**
 * Typed module event declarations.
 *
 * A `ModuleEventDef` is the typed handle a module exports for an event it
 * owns. The phantom `__payload` carries the payload type at compile time so
 * `ctx.events.emit(decl, payload)` and `ctx.events.subscribe(decl, handler)`
 * are checked against the declared shape. The `fields` array records the
 * declared payload field names at runtime so workflow trigger validation can
 * reject filters that reference nonexistent fields. The `scope` field
 * separates scope-scoped events (whose payloads carry `scopeId`) from daemon-wide events
 * (registry change, daemon lifecycle, session-bound
 * tool-call events that stay daemon-default until session-scopeId
 * attribution lands).
 *
 * Module-owned events live next to the module that emits them; consumers in
 * other modules import the declaration to get a typed subscriber. Truly
 * external events (inbound webhook surfaces, dynamic third-party event names)
 * use the visibly unsafe `emitExternal` / `subscribeExternal` escape hatch on
 * `ctx.events` and validate at the boundary.
 *
 * Module authors declare the scope explicitly through the helper they choose:
 * - the scope-event helper for directory-scope events.
 * - {@link defineDaemonWideModuleEvent} for daemon-wide events.
 *
 * The lower-level {@link defineModuleEvent} primitive both helpers wrap takes
 * `scope` as a required parameter so no module event can be declared without
 * picking one or the other.
 */

import type { BusEnvelope } from "./event-bus-types.js";
import { validatePayloadAgainstSchema } from "./module-event-payload-validation.js";
import {
  buildModuleEventSchemaContract,
  type ModuleEventCompatibilityPolicy,
  type ModuleEventOptions,
  type ModuleEventPayloadExample,
  type ModuleEventPayloadObject,
  type ModuleEventPayloadSchema,
  type ModuleEventSchema,
  type ModuleEventSensitivity,
  type ModuleEventWorkflowTriggerPolicy,
} from "./module-event-schema.js";

export type {
  ModuleEventCompatibilityPolicy,
  ModuleEventDiscriminatedUnionSchemaNode,
  ModuleEventObjectSchemaNode,
  ModuleEventOptions,
  ModuleEventPayloadExample,
  ModuleEventPayloadObject,
  ModuleEventPayloadSchema,
  ModuleEventPayloadValue,
  ModuleEventSchema,
  ModuleEventSchemaNode,
  ModuleEventSchemaProperties,
  ModuleEventSensitivity,
  ModuleEventWorkflowTriggerPolicy,
} from "./module-event-schema.js";

/**
 * Scope discriminator for {@link ModuleEventDef}. Scope events require a
 * canonical `scopeId`; daemon events are delivered without scope attribution.
 */
export type ModuleEventScope = "scope" | "daemon";

export type ModuleEventDef<TPayload extends object = object> = {
  readonly name: string;
  readonly fields: ReadonlyArray<string>;
  readonly scope: ModuleEventScope;
  readonly schema: ModuleEventSchema;
  readonly filterablePaths: ReadonlyArray<string>;
  readonly sensitivity: ModuleEventSensitivity;
  readonly compatibility: ModuleEventCompatibilityPolicy;
  readonly workflowTriggerPolicy: ModuleEventWorkflowTriggerPolicy;
  readonly examples: readonly ModuleEventPayloadExample<TPayload>[];
  readonly normalizeExternal?: (input: ModuleEventPayloadObject) => TPayload;
  /**
   * Phantom marker carrying the payload type for inference. Stored as a
   * function return so `ModuleEventDef<TSpecific>` is assignable to a wider
   * `ModuleEventDef<object>` (covariant). Always undefined at
   * runtime. The `defineModuleEvent` helper enforces that `TPayload` is a
   * object-shaped payload at construction time.
   */
  readonly __payload?: () => TPayload;
};

export function defineModuleEvent<TPayload extends object>(
  name: string,
  fields: ReadonlyArray<keyof TPayload & string>,
  scope: ModuleEventScope,
  options?: ModuleEventOptions<TPayload>,
): ModuleEventDef<TPayload> {
  const fieldList = fields.map((field) => field.trim());
  const contract = buildModuleEventSchemaContract<TPayload>(
    name,
    fieldList,
    options,
  );
  const base = {
    name,
    fields: fieldList,
    scope,
    schema: contract.schema,
    filterablePaths: contract.filterablePaths,
    sensitivity: contract.sensitivity,
    compatibility: contract.compatibility,
    workflowTriggerPolicy: contract.workflowTriggerPolicy,
    examples: contract.examples,
  };
  if (contract.normalizeExternal) {
    return { ...base, normalizeExternal: contract.normalizeExternal };
  }
  return base;
}

/**
 * Declare a daemon-wide module event. Use for module-owned events that have
 * no scope attribution (daemon-process lifecycle, registry/loader signals)
 * or that are still session-bound at the boundary and will migrate to a
 * scope declaration once session attribution lands.
 *
 * Daemon-wide module events bypass the `ScopedEventBus` filter — every
 * subscriber receives every emit. Document the rationale next to the
 * declaration so a future migration knows what changes.
 */
export function defineDaemonWideModuleEvent<TPayload extends object>(
  name: string,
  fields: ReadonlyArray<keyof TPayload & string>,
  options?: ModuleEventOptions<TPayload>,
): ModuleEventDef<TPayload> {
  return defineModuleEvent<TPayload>(name, fields, "daemon", options);
}

/**
 * Throws if `def` is scope-scoped and `payload` does not carry a non-empty
 * scope selector. Used by the lowest-level emit paths
 * (`EventBus.emit(def, payload)`, `ModuleEventProxy.emit(def, payload)`,
 * `tryEmit(def, payload)`) so callers cannot accidentally leak a
 * scope-scoped module event onto the bus without identity.
 */
export function assertModuleEventPayloadScope(
  def: ModuleEventDef,
  payload: ModuleEventPayloadObject,
): void {
  if (def.scope !== "scope") return;
  if (typeof payload.scopeId !== "string" || payload.scopeId.length === 0) {
    throw new Error(
      `Module event "${def.name}" is scope-scoped; emit payload must include a non-empty string scopeId. ` +
        `Emit through a ScopedEventBus to inject scope attribution automatically.`,
    );
  }
}

export function assertModuleEventPayload(
  def: ModuleEventDef,
  payload: ModuleEventPayloadObject,
): void {
  assertModuleEventPayloadScope(def, payload);
  const error = validatePayloadAgainstSchema(def.schema.payload, payload);
  if (error) {
    throw new Error(
      `Module event "${def.name}" payload failed schema v${def.schema.currentVersion}: ${error}`,
    );
  }
}

export type ModuleEventPayload<E> = E extends ModuleEventDef<infer P> ? P : never;

export type ModuleEventRegistration = {
  readonly module: string;
  readonly name: string;
  readonly scope: ModuleEventScope;
  readonly fields: ReadonlyArray<string>;
  readonly currentVersion: number;
  readonly payloadSchema: ModuleEventPayloadSchema;
  readonly filterablePaths: ReadonlyArray<string>;
  readonly sensitivity: ModuleEventSensitivity;
  readonly compatibility: ModuleEventCompatibilityPolicy;
  readonly workflowTriggerPolicy: ModuleEventWorkflowTriggerPolicy;
  readonly examples: readonly ModuleEventPayloadExample[];
};

class ModuleEventRegistry {
  private events = new Map<string, ModuleEventRegistration>();

  register(moduleName: string, def: ModuleEventDef): void {
    const next = registrationFromDef(moduleName, def);
    const prior = this.events.get(def.name);
    if (prior && prior.module !== moduleName) {
      throw new Error(
        `Module event "${def.name}" already declared by module "${prior.module}"; ` +
          `module "${moduleName}" cannot redeclare it. Each module event has a single owner.`,
      );
    }
    if (prior && !sameRegistrationContract(prior, next)) {
      throw new Error(
        `Module event "${def.name}" already declared by module "${moduleName}" with an incompatible schema. ` +
          `Existing version: ${prior.currentVersion}; new version: ${next.currentVersion}.`,
      );
    }
    this.events.set(def.name, next);
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

function registrationFromDef(
  moduleName: string,
  def: ModuleEventDef,
): ModuleEventRegistration {
  return {
    module: moduleName,
    name: def.name,
    scope: def.scope,
    fields: def.fields,
    currentVersion: def.schema.currentVersion,
    payloadSchema: def.schema.payload,
    filterablePaths: def.filterablePaths,
    sensitivity: def.sensitivity,
    compatibility: def.compatibility,
    workflowTriggerPolicy: def.workflowTriggerPolicy,
    examples: def.examples,
  };
}

function sameRegistrationContract(
  a: ModuleEventRegistration,
  b: ModuleEventRegistration,
): boolean {
  return (
    a.scope === b.scope &&
    JSON.stringify({
      fields: a.fields,
      currentVersion: a.currentVersion,
      payloadSchema: a.payloadSchema,
      filterablePaths: a.filterablePaths,
      sensitivity: a.sensitivity,
      compatibility: a.compatibility,
      workflowTriggerPolicy: a.workflowTriggerPolicy,
    }) ===
      JSON.stringify({
        fields: b.fields,
        currentVersion: b.currentVersion,
        payloadSchema: b.payloadSchema,
        filterablePaths: b.filterablePaths,
        sensitivity: b.sensitivity,
        compatibility: b.compatibility,
        workflowTriggerPolicy: b.workflowTriggerPolicy,
      })
  );
}
