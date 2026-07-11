import type { ControlRouteRegistration, ModuleContext } from "#core/modules/module-types.js";
import {
  readScopeSelectorQueryOrErrorResponse,
} from "#core/server/scope-selector-request.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import { resolveWorkflowStateRecoveryProject } from "./state-recovery-project.js";
import type {
  WorkflowStateRecoveryAction,
  WorkflowStateRecoveryResolveInput,
} from "./state-recovery-provider.js";
import {
  validateWorkflowStateRecoveryArtifactRunId,
  WORKFLOW_STATE_RECOVERY_PROVIDER_TYPE,
} from "./state-recovery-provider.js";

function isRecoveryAction(value: string | undefined): value is WorkflowStateRecoveryAction {
  return value === "release" || value === "supersede";
}

type ResolveBodyFields = {
  action?: string;
  rationale?: string;
  runId?: string;
  actor?: string;
  artifactRunId?: string;
  supersededByCommit?: string;
  cleanupWorktree?: boolean;
  discardWorktreeChanges?: boolean;
  dismissDeadLetters?: boolean;
  completeTask?: boolean;
};

function readResolveBody(body: ResolveBodyFields):
  | { ok: true; value: Omit<WorkflowStateRecoveryResolveInput, "projectDir" | "taskId"> }
  | { ok: false; message: string } {
  const action = body.action;
  if (!isRecoveryAction(action)) {
    return { ok: false, message: "Body must include action release or supersede" };
  }
  if (body.rationale === undefined || body.rationale.trim().length === 0) {
    return { ok: false, message: "Body must include non-empty string `rationale`" };
  }
  const artifactRunId = validateWorkflowStateRecoveryArtifactRunId(body.artifactRunId);
  if (!artifactRunId.ok) {
    return { ok: false, message: artifactRunId.message };
  }
  return {
    ok: true,
    value: {
      action,
      rationale: body.rationale,
      ...(typeof body.runId === "string" ? { runId: body.runId } : {}),
      ...(typeof body.actor === "string" ? { actor: body.actor } : {}),
      ...(artifactRunId.artifactRunId !== undefined
        ? { artifactRunId: artifactRunId.artifactRunId }
        : {}),
      ...(typeof body.supersededByCommit === "string"
        ? { supersededByCommit: body.supersededByCommit }
        : {}),
      ...(typeof body.cleanupWorktree === "boolean"
        ? { cleanupWorktree: body.cleanupWorktree }
        : {}),
      ...(typeof body.discardWorktreeChanges === "boolean"
        ? { discardWorktreeChanges: body.discardWorktreeChanges }
        : {}),
      ...(typeof body.dismissDeadLetters === "boolean"
        ? { dismissDeadLetters: body.dismissDeadLetters }
        : {}),
      ...(typeof body.completeTask === "boolean"
        ? { completeTask: body.completeTask }
        : {}),
    },
  };
}

function stringField(
  body: Awaited<ReturnType<typeof readBody>>,
  key: keyof ResolveBodyFields,
): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

function booleanField(
  body: Awaited<ReturnType<typeof readBody>>,
  key: keyof ResolveBodyFields,
): boolean | undefined {
  const value = body[key];
  return typeof value === "boolean" ? value : undefined;
}

export function workflowStateRecoveryControlRoutes(
  ctx: ModuleContext,
): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/workflow/state-recovery",
      capabilityScope: "read",
      handler: (req, res) => {
        const selector = readScopeSelectorQueryOrErrorResponse(req, res, "http://127.0.0.1");
        if (selector === null) return;
        const project = resolveWorkflowStateRecoveryProject(ctx, selector);
        if (!project.ok) {
          jsonResponse(res, 404, { error: project.message, reason: "unknown_project" });
          return;
        }
        const provider = ctx.getProvider(WORKFLOW_STATE_RECOVERY_PROVIDER_TYPE);
        if (!provider) {
          jsonResponse(res, 503, {
            ok: false,
            reason: "provider_unavailable",
            message: "Workflow state recovery provider is unavailable",
          });
          return;
        }
        jsonResponse(res, 200, provider.list({ ...selector, projectDir: project.projectDir }));
      },
    },
    {
      method: "POST",
      path: "/workflow/state-recovery/claims/:taskId/resolve",
      capabilityScope: "control",
      handler: async (req, res, params) => {
        const selector = readScopeSelectorQueryOrErrorResponse(req, res, "http://127.0.0.1");
        if (selector === null) return;
        const project = resolveWorkflowStateRecoveryProject(ctx, selector);
        if (!project.ok) {
          jsonResponse(res, 404, { error: project.message, reason: "unknown_project" });
          return;
        }
        const rawBody = await readBody(req);
        const body = readResolveBody({
          action: stringField(rawBody, "action"),
          rationale: stringField(rawBody, "rationale"),
          runId: stringField(rawBody, "runId"),
          actor: stringField(rawBody, "actor"),
          artifactRunId: stringField(rawBody, "artifactRunId"),
          supersededByCommit: stringField(rawBody, "supersededByCommit"),
          cleanupWorktree: booleanField(rawBody, "cleanupWorktree"),
          discardWorktreeChanges: booleanField(rawBody, "discardWorktreeChanges"),
          dismissDeadLetters: booleanField(rawBody, "dismissDeadLetters"),
          completeTask: booleanField(rawBody, "completeTask"),
        });
        if (!body.ok) {
          jsonResponse(res, 400, { error: body.message });
          return;
        }
        const provider = ctx.getProvider(WORKFLOW_STATE_RECOVERY_PROVIDER_TYPE);
        if (!provider) {
          jsonResponse(res, 503, {
            ok: false,
            reason: "provider_unavailable",
            message: "Workflow state recovery provider is unavailable",
          });
          return;
        }
        const result = provider.resolve({
          ...selector,
          ...body.value,
          taskId: params.taskId,
          projectDir: project.projectDir,
        });
        const status = result.ok
          ? 200
          : result.reason === "not_found"
            ? 404
            : result.reason === "unsafe" || result.reason === "write_conflict"
              ? 409
              : 400;
        jsonResponse(res, status, result);
      },
    },
  ];
}
