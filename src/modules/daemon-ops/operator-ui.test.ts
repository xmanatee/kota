import { describe, expect, it } from "vitest";
import { renderToString } from "#modules/rendering/transport.js";
import type { OperatorInboxSnapshot } from "./operator-inbox.js";
import {
  buildInboxUiSurface,
  buildStatusUiSurface,
  renderUiSurface,
} from "./operator-ui.js";
import type { StatusSnapshot } from "./status-cli.js";

function status(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    daemonRunning: false,
    activeRuns: 0,
    queuedRuns: 0,
    workflowPaused: false,
    sessions: 0,
    pendingApprovals: 0,
    projectDir: "/repo",
    projectName: "repo",
    controlFile: { kind: "missing" },
    historicalWorkflow: {
      activeRuns: 0,
      queuedRuns: 2,
      workflowPaused: false,
    },
    ...overrides,
  };
}

function inbox(overrides: Partial<OperatorInboxSnapshot> = {}): OperatorInboxSnapshot {
  return {
    projectDir: "/repo",
    generatedAt: "2026-06-12T08:00:00.000Z",
    items: [
      {
        kind: "runtime",
        id: "daemon-offline",
        title: "Daemon is offline",
        detail: "Dispatch, event stream, live sessions, and live run state are unavailable.",
        action: "kota daemon start",
        role: "warn",
      },
      {
        kind: "approval",
        id: "a1b2c3d4",
        title: "Approval required: shell.exec",
        detail: "dangerous: deploy",
        action: "kota approval list",
        role: "error",
      },
    ],
    counts: {
      runtime: 1,
      approval: 1,
      "owner-question": 0,
      "blocked-task": 0,
      setup: 0,
      "failed-run": 0,
    },
    ...overrides,
  };
}

describe("operator shared UI surfaces", () => {
  it("builds a typed Status surface with summary, warnings, and direct actions", () => {
    const surface = buildStatusUiSurface(status(), { explain: true });
    expect(surface.protocolVersion).toBe("ui.surface.v1");
    expect(surface.surfaceId).toBe("status");
    expect(surface.intent).toBe("Status");
    expect(surface.actions.map((action) => action.actionId)).toEqual([
      "daemon.start",
      "status.explain",
    ]);
    expect(surface.nodes.some((node) => node.kind === "status-summary")).toBe(true);
    expect(surface.nodes.some((node) => node.kind === "list" && node.title === "Warnings")).toBe(true);
  });

  it("builds a typed Inbox surface with item actions and an empty state arm", () => {
    const populated = buildInboxUiSurface(inbox());
    expect(populated.surfaceId).toBe("inbox");
    expect(populated.intent).toBe("Inbox");
    const list = populated.nodes.find((node) => node.kind === "list");
    expect(list?.items.map((item) => item.action?.actionId)).toContain("approval.open");
    const approval = list?.items.find((item) => item.id === "a1b2c3d4");
    expect(approval?.action.command).toBe("kota approval list");
    expect(approval?.action.effect).toBe("read");
    expect(approval?.action.confirmation).toBe("none");

    const clear = buildInboxUiSurface(inbox({ items: [] }));
    expect(clear.nodes.some((node) => node.kind === "empty")).toBe(true);
  });

  it("renders the shared Status and Inbox surfaces through the CLI renderer", () => {
    const rendered = renderToString(renderUiSurface(buildInboxUiSurface(inbox())), {
      width: 100,
    });
    expect(rendered).toContain("Inbox");
    expect(rendered).toContain("Daemon is offline");
    expect(rendered).toContain("kota approval list");
  });
});
