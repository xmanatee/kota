import type {
  UiSurfaceProjectionContext,
  UiSurfaceSource,
} from "#core/modules/module-ui-surfaces.js";
import { buildOperatorInboxSnapshot } from "./operator-inbox.js";
import {
  buildContinuityProjection,
  buildContinuityUiSurface,
  buildInboxUiSurface,
  buildScopeUiSurface,
  buildStatusUiSurface,
} from "./operator-ui.js";
import { gatherStatus, type StatusSnapshot } from "./status-cli.js";

async function readStatus(context: UiSurfaceProjectionContext): Promise<StatusSnapshot> {
  const selected = context.scopeId.startsWith("dir:")
    ? undefined
    : { projectId: context.scopeId };
  return gatherStatus(context.cwd, selected);
}

const statusSource: UiSurfaceSource = {
  sourceId: "status",
  project: async (context) => [
    buildStatusUiSurface(await readStatus(context), {
      explain: true,
      scopeId: context.scopeId,
    }),
  ],
};

const scopesSource: UiSurfaceSource = {
  sourceId: "scopes",
  project: async (context) => {
    const [projects, sessions] = await Promise.all([
      context.read("projects", () => context.client.projects.list()),
      context.read("sessions", () => context.client.sessions.list()),
    ]);
    return [buildScopeUiSurface({
      scopeId: context.scopeId,
      projects,
      sessions,
    })];
  },
};

const inboxSource: UiSurfaceSource = {
  sourceId: "inbox",
  project: async (context) => {
    const status = await readStatus(context);
    const inbox = await buildOperatorInboxSnapshot({
      client: context.client,
      projectDir: context.cwd,
      status,
    });
    return [buildInboxUiSurface(inbox, context.scopeId)];
  },
};

const continuitySource: UiSurfaceSource = {
  sourceId: "continuity",
  project: async (context) => {
    const [
      tasks,
      workflowStatus,
      runs,
      definitions,
      approvals,
      ownerQuestions,
      ownerDecisions,
      setup,
      memory,
      knowledge,
    ] = await Promise.all([
      context.read("tasks", () => context.client.tasks.list(["doing", "ready", "blocked"])),
      context.read("workflow status", () => context.client.workflow.status()),
      context.read("workflow runs", () => context.client.workflow.listRuns({ limit: 20 })),
      context.read("workflow definitions", () => context.client.workflow.listDefinitions()),
      context.read("approvals", () => context.client.approvals.list({ status: "pending" })),
      context.read("owner questions", () => context.client.ownerQuestions.list({ status: "pending" })),
      context.read("owner decisions", () => context.client.ownerDecisions.list({ status: "pending" })),
      context.read("setup", () => context.client.setup.list()),
      context.read("memory", () => context.client.memory.list({ limit: 10 })),
      context.read("knowledge", () => context.client.knowledge.list()),
    ]);
    return [buildContinuityUiSurface(buildContinuityProjection({
      scopeId: context.scopeId,
      tasks,
      workflowStatus,
      runs,
      definitions,
      approvals,
      ownerQuestions,
      ownerDecisions,
      setup,
      memory,
      knowledge,
    }))];
  },
};

export const daemonOpsUiSurfaceSources = [
  statusSource,
  scopesSource,
  inboxSource,
  continuitySource,
] as const satisfies readonly UiSurfaceSource[];
