import { describe, expect, it } from "vitest";
import {
  buildUiSurfaceBundle,
  type UiAction,
  type UiSurface,
  validateUiSurfaceBundle,
} from "./ui-surface.js";

function action(overrides: Partial<UiAction> = {}): UiAction {
  return {
    surfaceId: "demo",
    actionId: "demo.refresh",
    scopeId: "p-demo",
    label: "Refresh",
    effect: "read",
    operation: { kind: "daemon-route", method: "GET", path: "/ui/surfaces" },
    confirmation: { mode: "none" },
    readiness: { state: "ready" },
    result: {
      success: { message: "Refreshed." },
      errors: [{ reason: "unavailable", message: "Unavailable." }],
    },
    ...overrides,
  };
}

function surface(overrides: Partial<UiSurface> = {}): UiSurface {
  const actions = overrides.actions ?? [action()];
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "demo",
    extensionId: "demo.surface",
    title: "Demo",
    intent: "Work",
    scopeId: "p-demo",
    attachmentPoint: { kind: "root" },
    order: 10,
    nodes: [],
    actions,
    ...overrides,
  };
}

function expectInvalid(surfaceOverride: Partial<UiSurface>, message: RegExp): void {
  expect(() =>
    validateUiSurfaceBundle({
      protocolVersion: "ui.surface.v1",
      surfaces: [surface(surfaceOverride)],
    }),
  ).toThrow(message);
}

describe("ui surface validation", () => {
  it("accepts a valid surface bundle", () => {
    expect(buildUiSurfaceBundle([surface()]).surfaces.map((entry) => entry.surfaceId)).toEqual(["demo"]);
  });

  it("accepts typed links, tabs, logs, and live log streams", () => {
    const bundle = buildUiSurfaceBundle([
      surface({
        nodes: [
          {
            kind: "link",
            label: "Open shared UI",
            target: { kind: "daemon-route", path: "/ui/surfaces" },
            role: "info",
          },
          {
            kind: "tabs",
            title: "Workspaces",
            activeTabId: "runs",
            tabs: [
              { id: "runs", label: "Runs", nodes: [{ kind: "detail", title: "Runs", body: "Live runs" }] },
              { id: "setup", label: "Setup", nodes: [{ kind: "detail", title: "Setup", body: "Requirements" }] },
            ],
          },
          {
            kind: "log",
            title: "Recent log",
            entries: [{ timestamp: "2026-06-18T19:36:34.590Z", level: "info", message: "Run started." }],
          },
          {
            kind: "log-stream",
            title: "Events",
            streamId: "daemon-events",
            source: { kind: "sse", path: "/events", eventTypes: ["workflow.run.completed"] },
            entries: [{ timestamp: "2026-06-18T19:37:00.000Z", level: "warn", message: "Approval pending." }],
          },
        ],
      }),
    ]);

    expect(bundle.surfaces[0]?.nodes.map((node) => node.kind)).toEqual(["link", "tabs", "log", "log-stream"]);
  });

  it("rejects unknown surface, node, and action discriminants", () => {
    expectInvalid({
      attachmentPoint: { kind: "dock" } as unknown as UiSurface["attachmentPoint"],
    }, /attachmentPoint\.kind "dock" must be one of/);

    expectInvalid({
      nodes: [{ kind: "timeline" } as unknown as UiSurface["nodes"][number]],
    }, /node timeline\.kind "timeline" must be one of/);

    expectInvalid({
      nodes: [{ kind: "link", label: "Future", target: { kind: "teleport" } } as unknown as UiSurface["nodes"][number]],
    }, /target\.kind "teleport" must be one of/);

    expectInvalid({
      nodes: [
        {
          kind: "log-stream",
          title: "Future stream",
          streamId: "future-stream",
          source: { kind: "websocket", path: "/events", eventTypes: ["workflow.run.completed"] },
          entries: [],
        } as unknown as UiSurface["nodes"][number],
      ],
    }, /source\.kind "websocket" must be one of/);

    expectInvalid({
      actions: [
        action({
          effect: "dangerous" as unknown as UiAction["effect"],
        }),
      ],
    }, /action demo\.refresh\.effect "dangerous" must be one of/);

    expectInvalid({
      actions: [
        action({
          operation: { kind: "shell-command" } as unknown as UiAction["operation"],
        }),
      ],
    }, /operation\.kind "shell-command" must be one of/);

    expectInvalid({
      actions: [
        action({
          confirmation: { mode: "prompt" } as unknown as UiAction["confirmation"],
        }),
      ],
    }, /confirmation\.mode "prompt" must be one of/);

    expectInvalid({
      actions: [
        action({
          readiness: { state: "waiting" } as unknown as UiAction["readiness"],
        }),
      ],
    }, /readiness\.state "waiting" must be one of/);
  });

  it("validates condition ids and duplicate condition arms", () => {
    expectInvalid({
      conditions: [{ kind: "capability", capabilityId: "Bad Id", status: "ready" }],
    }, /capabilityId/);

    expectInvalid({
      conditions: [
        { kind: "capability", capabilityId: "workflow.trigger", status: "ready" },
        { kind: "capability", capabilityId: "workflow.trigger", status: "ready" },
      ],
    }, /duplicate surface demo condition/);
  });

  it("rejects malformed required confirmation metadata", () => {
    expectInvalid({
      actions: [
        action({
          confirmation: {
            mode: "required",
            title: "Confirm",
            detail: " ",
            confirmLabel: "Proceed",
            risk: "medium",
          },
        }),
      ],
    }, /confirmation\.detail must not be empty/);
  });

  it("rejects mismatched action parameter fields and schema", () => {
    expectInvalid({
      actions: [
        action({
          parameters: {
            schema: {
              type: "object",
              properties: { workflow: { type: "string" } },
              required: ["workflow"],
            },
            fields: [{ id: "missing", label: "Missing", input: "text", required: true }],
          },
        }),
      ],
    }, /fields references missing schema property "missing"/);

    expectInvalid({
      actions: [
        action({
          parameters: {
            schema: {
              type: "object",
              properties: { workflow: { type: "string" } },
              required: ["workflow"],
            },
            fields: [],
          },
        }),
      ],
    }, /requires "workflow" but no matching field/);
  });

  it("rejects invalid result and error outcome arms", () => {
    expectInvalid({
      actions: [
        action({
          result: {
            success: { message: "" },
            errors: [{ reason: "unavailable", message: "Unavailable." }],
          },
        }),
      ],
    }, /result\.success\.message must not be empty/);

    expectInvalid({
      actions: [
        action({
          result: {
            success: { message: "Refreshed." },
            errors: [
              { reason: "unavailable", message: "Unavailable." },
              { reason: "unavailable", message: "" },
            ],
          },
        }),
      ],
    }, /duplicate surface demo action demo.refresh result error reason/);

    expectInvalid({
      actions: [
        action({
          result: {
            success: { message: "Refreshed." },
            errors: [{ reason: "invalid-input", message: "" }],
          },
        }),
      ],
    }, /result\.errors\.invalid-input\.message must not be empty/);
  });
});
