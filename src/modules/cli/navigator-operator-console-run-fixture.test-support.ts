import type {
  UiAction,
  UiSurfaceBundle,
} from "#modules/daemon-ops/operator-ui.js";
import { consoleAction } from "./navigator-operator-console-fixture-actions.test-support.js";
import { navigationSurface } from "./navigator-test-surfaces.test-support.js";

function runAction(actions: readonly UiAction[], actionId: string): UiAction {
  const found = actions.find((candidate) => candidate.actionId === actionId);
  if (!found) throw new Error(`missing fixture run action ${actionId}`);
  return found;
}

export function inboxAndRunSurfaces(actions: readonly UiAction[]): UiSurfaceBundle["surfaces"] {
  return [
    navigationSurface({
      surfaceId: "inbox",
      title: "Inbox",
      intent: "Inbox",
      order: 20,
      actions: [
        consoleAction({ surfaceId: "inbox", actionId: "inbox.refresh", label: "Refresh inbox", namespace: "workflow", method: "status" }),
      ],
      nodes: [{
        kind: "status-summary",
        entries: [
          { label: "Runtime", value: "0", role: "muted" },
          { label: "Approvals", value: "1", role: "warn" },
          { label: "Owner questions", value: "1", role: "warn" },
          { label: "Blocked", value: "0", role: "muted" },
          { label: "Setup", value: "2", role: "warn" },
          { label: "Failed runs", value: "1", role: "error" },
        ],
      }],
    }),
    navigationSurface({
      surfaceId: "runs",
      title: "Runs and Automations",
      intent: "Work",
      order: 30,
      actions,
      nodes: [
        {
          kind: "status-summary",
          entries: [
            { label: "Dispatch", value: "running", role: "success" },
            { label: "Active", value: "1", role: "warn" },
            { label: "Queued", value: "2", role: "warn" },
            { label: "Definitions", value: "12", role: "success" },
            { label: "Approvals", value: "1", role: "warn" },
            { label: "Owner questions", value: "1", role: "warn" },
            { label: "Sessions", value: "1", role: "success" },
          ],
        },
        {
          kind: "table",
          title: "Active run supervision",
          columns: [
            { id: "name", label: "Name" },
            { id: "state", label: "State" },
            { id: "detail", label: "Detail" },
          ],
          rows: [{
            id: "run-active-1",
            cells: [
              { columnId: "name", value: "run-active-1", role: "info" },
              { columnId: "state", value: "builder", role: "success" },
              { columnId: "detail", value: "started 2026-07-07T00:00:00.000Z", role: "muted" },
            ],
            action: runAction(actions, "run.abort"),
          }],
        },
        {
          kind: "table",
          title: "Queued workflow runs",
          columns: [
            { id: "name", label: "Name" },
            { id: "state", label: "State" },
            { id: "detail", label: "Detail" },
          ],
          rows: [{
            id: "queued-run-1",
            cells: [
              { columnId: "name", value: "queued-run-1", role: "info" },
              { columnId: "state", value: "improver", role: "warn" },
              { columnId: "detail", value: "enqueued 2026-07-07T00:01:00.000Z", role: "muted" },
            ],
            action: runAction(actions, "run.cancel-queued"),
          }],
        },
        {
          kind: "table",
          title: "Recent run results",
          columns: [
            { id: "name", label: "Name" },
            { id: "state", label: "State" },
            { id: "detail", label: "Detail" },
          ],
          rows: [
            {
              id: "run-failed-1",
              cells: [
                { columnId: "name", value: "run-failed-1", role: "info" },
                { columnId: "state", value: "builder failed", role: "error" },
                { columnId: "detail", value: "2026-07-07T00:02:00.000Z", role: "muted" },
              ],
              action: runAction(actions, "run.retry"),
            },
            {
              id: "run-success-1",
              cells: [
                { columnId: "name", value: "run-success-1", role: "info" },
                { columnId: "state", value: "builder success", role: "success" },
                { columnId: "detail", value: "2026-07-07T00:03:00.000Z", role: "muted" },
              ],
              action: runAction(actions, "run.replay"),
            },
          ],
        },
        {
          kind: "log-stream",
          title: "Live run event stream",
          streamId: "workflow-events",
          source: { kind: "sse", path: "/events", eventTypes: ["workflow.started", "workflow.step.completed", "workflow.completed"] },
          entries: [{
            timestamp: "2026-07-07T00:00:00.000Z",
            level: "info",
            source: "workflow.builder",
            message: "Active run run-active-1 is executing.",
          }],
        },
        { kind: "action-list", title: "Run controls", actions },
      ],
    }),
  ];
}
