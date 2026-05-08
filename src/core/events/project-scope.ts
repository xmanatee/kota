/**
 * Project scope primitives for the typed event bus.
 *
 * The KOTA daemon hosts one or more configured projects. Most runtime events
 * belong to a specific project (workflow runs, queue shape, approvals,
 * sessions). A few are daemon-wide (registry change, daemon lifecycle).
 *
 * This module owns the typed primitives that distinguish the two and the
 * wrapper bus per-project subsystems use to emit / subscribe without threading
 * `projectId` through every call. The runtime registry that derives ids from
 * project roots and tracks configured projects lives in
 * `#core/daemon/project-registry.js`; the type alias is owned here so
 * `events/` and other foundational subsystems can import it without taking a
 * daemon-tree dependency.
 *
 * Slice 3a (this file) ships the primitives and a focused isolation test.
 * Slice 3b migrates per-project core subsystems (workflow runtime, scheduler,
 * approval/owner-question queues, task store) onto these primitives. Slice 3c
 * migrates module-defined events.
 */

import type { EventBus } from "./event-bus.js";
import {
  defineModuleEvent,
  type ModuleEventDef,
  type ModuleEventPayload,
} from "./module-event.js";

/** Object-shaped event payload constraint, used only inside this module. */
type Payload = Record<string, unknown>;

/**
 * Stable opaque project identity. Re-exported as-is by
 * `#core/daemon/project-registry.js`, where the deterministic derivation and
 * file-backed registry live.
 */
export type ProjectId = string;

/**
 * Helper that adds the required `projectId` field to a base payload type.
 * Used by both the BusEvents map (slice 3b) and module-event declarations
 * to express "this event is project-scoped" without admitting nullable
 * variants.
 */
export type ProjectScopedPayload<T extends Payload = Payload> = T & {
  projectId: ProjectId;
};

/**
 * Discriminated event scope. `kind: "project"` events carry a `projectId`;
 * `kind: "daemon"` events are daemon-wide (registry change, daemon lifecycle).
 *
 * Today the discriminator is expressed by the presence or absence of
 * `projectId` on the payload. The `EventScope` union exists so slice 3b
 * subsystems that need to reason about scope at runtime (project router,
 * cross-project filters) can do so without parsing payloads.
 */
export type EventScope =
  | { kind: "project"; projectId: ProjectId }
  | { kind: "daemon" };

/**
 * Typed module event whose payload is always project-scoped. Subscribers
 * always see a typed `projectId` field; emitters always supply one (either
 * directly through the raw `EventBus` or by going through
 * {@link ProjectScopedEventBus}, which injects it).
 */
export type ProjectScopedModuleEventDef<TPayload extends Payload = Payload> =
  ModuleEventDef<ProjectScopedPayload<TPayload>>;

/**
 * Declare a project-scoped module event. The runtime fields list always
 * includes `projectId` so workflow trigger filters can reference it without
 * each module declaration restating the field.
 */
export function defineProjectScopedModuleEvent<TPayload extends Payload>(
  name: string,
  fields: ReadonlyArray<keyof TPayload & string>,
): ProjectScopedModuleEventDef<TPayload> {
  const allFields: ReadonlyArray<keyof ProjectScopedPayload<TPayload> & string> = [
    "projectId",
    ...fields,
  ];
  return defineModuleEvent<ProjectScopedPayload<TPayload>>(name, allFields);
}

/**
 * Per-project view over a shared underlying {@link EventBus}.
 *
 * Constructed once per project by the daemon's per-project bundle. Emit
 * injects `projectId` into the payload; subscribe filters delivery so the
 * subscriber only sees this view's project. Cross-project listeners that
 * want every project's events still go through the raw bus.
 *
 * The wrapper does not own the underlying bus's lifecycle. Multiple views
 * share one bus, and clearing the bus clears every view.
 */
export class ProjectScopedEventBus {
  constructor(
    private readonly bus: EventBus,
    private readonly projectId: ProjectId,
  ) {}

  /** This view's stable project id. */
  getProjectId(): ProjectId {
    return this.projectId;
  }

  /** The underlying shared bus. Use sparingly — most callers should not need it. */
  getUnderlying(): EventBus {
    return this.bus;
  }

  /** Emit a project-scoped event with `projectId` injected automatically. */
  emit<TPayload extends Payload>(
    event: ProjectScopedModuleEventDef<TPayload>,
    payload: TPayload,
  ): void {
    this.bus.emit(event, { ...payload, projectId: this.projectId });
  }

  /**
   * Subscribe to a project-scoped event. The handler only fires for payloads
   * tagged with this view's `projectId`. Returns an unsubscribe function.
   */
  on<E extends ProjectScopedModuleEventDef>(
    event: E,
    handler: (payload: ModuleEventPayload<E>) => void,
  ): () => void {
    return this.bus.on(event, (payload) => {
      if ((payload as ProjectScopedPayload).projectId !== this.projectId) return;
      handler(payload);
    });
  }
}
