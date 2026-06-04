import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusEnvelope } from "#core/events/event-bus.js";
import { EventBus } from "#core/events/event-bus.js";
import {
  defineDaemonWideModuleEvent,
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { WorkflowRunStore } from "../run-store.js";
import type { WorkflowRunMetadata } from "../run-types.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import { createStepContext, EMITTED_EVENTS_LOG_FILENAME } from "./step-context.js";

function tempProject(): string {
  const dir = join(
    tmpdir(),
    `kota-step-context-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeMetadata(): WorkflowRunMetadata {
  return {
    id: "run-1",
    workflow: "repo-ai-checks",
    definitionPath: "workflow.ts",
    trigger: { event: "manual", schemaRef: null, payload: {} },
    startedAt: "2026-06-04T00:00:00.000Z",
    status: "running",
    runDir: ".kota/runs/run-1",
    steps: [],
  };
}

const trigger: WorkflowRunTrigger = {
  event: "manual",
  schemaRef: null,
  payload: {},
};

afterEach(() => {
  resetModuleEventRegistry();
});

describe("createStepContext", () => {
  it("emits registered daemon-wide dynamic events without injecting scope fields", () => {
    const projectDir = tempProject();
    try {
      const event = defineDaemonWideModuleEvent<{ repo: string }>(
        "step-context.daemon.completed",
        ["repo"],
        {
          payloadSchema: {
            type: "object",
            properties: { repo: { type: "string" } },
            additionalProperties: false,
          },
        },
      );
      initModuleEventRegistry().register("step-context-test", event);

      const bus = new EventBus();
      const pbus = new ProjectScopedEventBus(bus, "scope-a");
      const store = new WorkflowRunStore(projectDir);
      const wildcard = vi.fn();
      bus.on("*", wildcard);

      const context = createStepContext(
        makeMetadata(),
        trigger,
        undefined,
        {},
        {},
        [],
        { projectDir, bus, pbus, store },
      );

      context.emit(event.name, { repo: "owner/repo" });

      expect(wildcard).toHaveBeenCalledWith({
        type: event.name,
        schemaRef: { name: event.name, version: 1 },
        payload: { repo: "owner/repo" },
      } satisfies BusEnvelope);
      const logPath = join(
        projectDir,
        ".kota/runs/run-1",
        EMITTED_EVENTS_LOG_FILENAME,
      );
      const logged = JSON.parse(readFileSync(logPath, "utf8").trim()) as {
        event: string;
        schemaRef: BusEnvelope["schemaRef"];
        payload: Record<string, unknown>;
      };
      expect(logged.event).toBe(event.name);
      expect(logged.schemaRef).toEqual({ name: event.name, version: 1 });
      expect(logged.payload).toEqual({ repo: "owner/repo" });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
