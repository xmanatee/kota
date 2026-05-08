/**
 * Cross-cutting policy gate for module-defined events.
 *
 * Every module-owned `ModuleEventDef` (declared via `defineModuleEvent` /
 * `defineProjectScopedModuleEvent` / `defineDaemonWideModuleEvent`) carries
 * an explicit `scope` discriminator so the runtime can enforce
 * project-scoped emit invariants without relying on prose convention. The
 * helper signatures make scope mandatory at construction; this test pins
 * the contract by importing every shipped declaration and asserting the
 * resolved scope, plus exercising the runtime guard end-to-end against the
 * one project-scoped declaration that exists today
 * (`eval-harness.set.completed`).
 *
 * When a future module adds a new event, this test forces the author to
 * pick a scope explicitly: dropping a declaration in here without
 * classifying it fails the suite. The test lives at the `src/` integration
 * tier (rather than under `src/core/events/`) because it imports from
 * `#modules/*`, which is forbidden in core tests.
 */

import { describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import type { ModuleEventDef } from "#core/events/module-event.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { evalHarnessSetCompleted } from "#modules/eval-harness/events.js";
import { injectionDefenseAssessed } from "#modules/injection-defense/events.js";
import { webhookChannelSession } from "#modules/webhook-channel/events.js";

const PROJECT_SCOPED: ModuleEventDef[] = [evalHarnessSetCompleted];
const DAEMON_WIDE: ModuleEventDef[] = [injectionDefenseAssessed, webhookChannelSession];

describe("module event scope policy", () => {
  it("every project-scoped module event prepends projectId to its declared field set", () => {
    for (const def of PROJECT_SCOPED) {
      expect(def.scope, `${def.name}.scope`).toBe("project");
      expect(def.fields[0], `${def.name}.fields[0]`).toBe("projectId");
    }
  });

  it("every daemon-wide module event omits projectId from its declared field set", () => {
    for (const def of DAEMON_WIDE) {
      expect(def.scope, `${def.name}.scope`).toBe("daemon");
      expect(def.fields, `${def.name}.fields`).not.toContain("projectId");
    }
  });

  it("EventBus.emit rejects every project-scoped module event when projectId is missing", () => {
    const bus = new EventBus();
    for (const def of PROJECT_SCOPED) {
      expect(
        () => bus.emit(def, {} as unknown as never),
        `${def.name} emit without projectId`,
      ).toThrow(/project-scoped/);
    }
  });

  it("ProjectScopedEventBus injects projectId on emit for every project-scoped module event", () => {
    const bus = new EventBus();
    const pbus = new ProjectScopedEventBus(bus, "policy-test-project");
    for (const def of PROJECT_SCOPED) {
      const observed: { projectId?: unknown }[] = [];
      const off = bus.on(def.name, (payload) =>
        observed.push(payload as { projectId?: unknown }),
      );
      try {
        // The emit signature on `pbus` is checked at construction time per
        // declaration; the test runs through the dynamic emit path so a
        // single loop body covers every declared shape.
        pbus.emitDynamic(def.name, {});
        expect(observed, `${def.name}`).toHaveLength(1);
        expect(observed[0]?.projectId, `${def.name}.projectId`).toBe(
          "policy-test-project",
        );
      } finally {
        off();
      }
    }
  });
});
