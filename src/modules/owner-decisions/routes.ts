import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getOwnerDecisionStore,
  type OwnerDecisionSelectedValue,
  type OwnerDecisionStatus,
  type OwnerDecisionStore,
} from "#core/daemon/owner-decision-store.js";
import {
  getOwnerQuestionQueue,
  type OwnerQuestionQueue,
} from "#core/daemon/owner-question-queue.js";
import {
  DAEMON_SCOPE_PROVIDER_TYPE,
  type DaemonScopeProvider,
} from "#core/daemon/scope-provider.js";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import {
  type NormalizedScopeSelector,
  selectedScopeSelectorId,
} from "#core/server/scope-selector.js";
import { readScopeSelectorQueryOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import {
  answerOwnerDecisionLocal,
  cancelOwnerDecisionLocal,
  listOwnerDecisionsLocal,
  showOwnerDecisionLocal,
} from "./operations.js";

const RESOLUTION_SOURCE = "http";
const VALID_STATUSES: readonly (OwnerDecisionStatus | "all")[] = [
  "all",
  "pending",
  "answered",
  "canceled",
  "expired",
  "consumed",
];

type OwnerDecisionQueues = {
  decisionStore: OwnerDecisionStore;
  questionQueue: OwnerQuestionQueue;
};

export type OwnerDecisionScopeProviderResolver = () => DaemonScopeProvider | null;

function resolveLegacyScopeProvider(): DaemonScopeProvider | null {
  return getProviderRegistry()?.get(DAEMON_SCOPE_PROVIDER_TYPE) ?? null;
}

type AnswerBody = {
  selectedValue?: OwnerDecisionSelectedValue;
};

type CancelBody = {
  reason?: string;
};

function readStatusFilter(req: IncomingMessage): OwnerDecisionStatus | "all" | undefined {
  const status = new URL(req.url ?? "", "http://localhost").searchParams.get("status");
  if (status === null) return undefined;
  if ((VALID_STATUSES as readonly string[]).includes(status)) return status as OwnerDecisionStatus | "all";
  return undefined;
}

function resolveQueues(
  res: ServerResponse,
  selector?: NormalizedScopeSelector,
  getScopeProvider: OwnerDecisionScopeProviderResolver = resolveLegacyScopeProvider,
): OwnerDecisionQueues | null {
  const scopeProvider = getScopeProvider();
  if (!scopeProvider) {
    return {
      decisionStore: getOwnerDecisionStore(),
      questionQueue: getOwnerQuestionQueue(),
    };
  }
  const resolved = scopeProvider.resolveScopeRuntime(selectedScopeSelectorId(selector));
  if (!resolved.ok) {
    jsonResponse(res, 404, resolved.error);
    return null;
  }
  return {
    decisionStore: resolved.runtime.ownerDecisionStore,
    questionQueue: resolved.runtime.ownerQuestionQueue,
  };
}

async function readSelectedValue(req: IncomingMessage): Promise<OwnerDecisionSelectedValue | null> {
  try {
    const body = (await readBody(req)) as AnswerBody;
    return body.selectedValue ?? null;
  } catch {
    return null;
  }
}

async function readCancelReason(req: IncomingMessage): Promise<string> {
  try {
    const body = (await readBody(req)) as CancelBody;
    return typeof body.reason === "string" && body.reason.trim() ? body.reason : "canceled";
  } catch {
    return "canceled";
  }
}

export async function handleListOwnerDecisions(
  req: IncomingMessage,
  res: ServerResponse,
  getScopeProvider?: OwnerDecisionScopeProviderResolver,
): Promise<void> {
  const selector = readScopeSelectorQueryOrErrorResponse(req, res);
  if (selector === null) return;
  const queues = resolveQueues(res, selector, getScopeProvider);
  if (!queues) return;
  jsonResponse(res, 200, listOwnerDecisionsLocal(queues.decisionStore, readStatusFilter(req)));
}

export async function handleShowOwnerDecision(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  getScopeProvider?: OwnerDecisionScopeProviderResolver,
): Promise<void> {
  const selector = readScopeSelectorQueryOrErrorResponse(req, res);
  if (selector === null) return;
  const queues = resolveQueues(res, selector, getScopeProvider);
  if (!queues) return;
  const decision = showOwnerDecisionLocal(queues.decisionStore, id);
  if (!decision) {
    jsonResponse(res, 404, { error: "Owner decision not found" });
    return;
  }
  jsonResponse(res, 200, { decision });
}

export async function handleAnswerOwnerDecision(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  getScopeProvider?: OwnerDecisionScopeProviderResolver,
): Promise<void> {
  const selectedValue = await readSelectedValue(req);
  if (!selectedValue) {
    jsonResponse(res, 400, { error: "selectedValue is required" });
    return;
  }
  const selector = readScopeSelectorQueryOrErrorResponse(req, res);
  if (selector === null) return;
  const queues = resolveQueues(res, selector, getScopeProvider);
  if (!queues) return;
  try {
    const decision = answerOwnerDecisionLocal(
      queues.decisionStore,
      queues.questionQueue,
      id,
      selectedValue,
      RESOLUTION_SOURCE,
    );
    if (!decision) {
      jsonResponse(res, 404, { error: "Owner decision not found or already resolved" });
      return;
    }
    jsonResponse(res, 200, { decision });
  } catch (err) {
    jsonResponse(res, 400, { error: err instanceof Error ? err.message : "invalid owner decision answer" });
  }
}

export async function handleCancelOwnerDecision(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  getScopeProvider?: OwnerDecisionScopeProviderResolver,
): Promise<void> {
  const reason = await readCancelReason(req);
  const selector = readScopeSelectorQueryOrErrorResponse(req, res);
  if (selector === null) return;
  const queues = resolveQueues(res, selector, getScopeProvider);
  if (!queues) return;
  const decision = cancelOwnerDecisionLocal(
    queues.decisionStore,
    queues.questionQueue,
    id,
    reason,
    RESOLUTION_SOURCE,
  );
  if (!decision) {
    jsonResponse(res, 404, { error: "Owner decision not found or already resolved" });
    return;
  }
  jsonResponse(res, 200, { decision });
}

export function ownerDecisionRoutes(
  getScopeProvider?: OwnerDecisionScopeProviderResolver,
): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/owner-decisions",
      handler: (req, res) => handleListOwnerDecisions(req, res, getScopeProvider),
    },
    {
      method: "GET",
      path: "/api/owner-decisions/:id",
      handler: (req, res, params) =>
        handleShowOwnerDecision(req, res, params.id, getScopeProvider),
    },
    {
      method: "POST",
      path: "/api/owner-decisions/:id/answer",
      handler: (req, res, params) =>
        handleAnswerOwnerDecision(req, res, params.id, getScopeProvider),
    },
    {
      method: "POST",
      path: "/api/owner-decisions/:id/cancel",
      handler: (req, res, params) =>
        handleCancelOwnerDecision(req, res, params.id, getScopeProvider),
    },
  ];
}

export function ownerDecisionControlRoutes(
  getScopeProvider?: OwnerDecisionScopeProviderResolver,
): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/owner-decisions",
      capabilityScope: "read",
      handler: (req, res) => handleListOwnerDecisions(req, res, getScopeProvider),
    },
    {
      method: "GET",
      path: "/owner-decisions/:id",
      capabilityScope: "read",
      handler: (req, res, params) =>
        handleShowOwnerDecision(req, res, params.id, getScopeProvider),
    },
    {
      method: "POST",
      path: "/owner-decisions/:id/answer",
      capabilityScope: "control",
      handler: (req, res, params) =>
        handleAnswerOwnerDecision(req, res, params.id, getScopeProvider),
    },
    {
      method: "POST",
      path: "/owner-decisions/:id/cancel",
      capabilityScope: "control",
      handler: (req, res, params) =>
        handleCancelOwnerDecision(req, res, params.id, getScopeProvider),
    },
  ];
}
