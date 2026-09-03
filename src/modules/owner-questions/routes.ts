import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getOwnerQuestionQueue,
  type OwnerQuestionQueue,
  type OwnerQuestionStatus,
  type PendingOwnerQuestion,
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
  type ScopeSelectorArgument,
  selectedScopeSelectorId,
} from "#core/server/scope-selector.js";
import { readScopeSelectorQueryOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";

const RESOLUTION_SOURCE = "http";

const VALID_STATUSES: readonly (OwnerQuestionStatus | "all")[] = [
  "all",
  "pending",
  "answered",
  "dismissed",
  "expired",
];

export type OwnerQuestionScopeProviderResolver = () => DaemonScopeProvider | null;

function resolveLegacyScopeProvider(): DaemonScopeProvider | null {
  return getProviderRegistry()?.get(DAEMON_SCOPE_PROVIDER_TYPE) ?? null;
}

export function readOwnerQuestionStatusFilter(
  req: IncomingMessage,
): OwnerQuestionStatus | "all" | undefined {
  const status = new URL(req.url ?? "", "http://localhost").searchParams.get("status");
  if (status === null) return undefined;
  if ((VALID_STATUSES as readonly string[]).includes(status)) {
    return status as OwnerQuestionStatus | "all";
  }
  return undefined;
}

function resolveOwnerQuestionQueue(
  res: ServerResponse,
  queue?: OwnerQuestionQueue,
  selector?: ScopeSelectorArgument,
  getScopeProvider: OwnerQuestionScopeProviderResolver = resolveLegacyScopeProvider,
): OwnerQuestionQueue | null {
  if (queue) return queue;
  const scopeProvider = getScopeProvider();
  if (!scopeProvider) return getOwnerQuestionQueue();
  const resolved = scopeProvider.resolveScopeRuntime(selectedScopeSelectorId(selector));
  if (!resolved.ok) {
    jsonResponse(res, 404, resolved.error);
    return null;
  }
  return resolved.runtime.ownerQuestionQueue;
}

export function listOwnerQuestionsLocal(
  queue: OwnerQuestionQueue,
  status?: OwnerQuestionStatus | "all",
): { questions: PendingOwnerQuestion[] } {
  if (status === undefined) return { questions: queue.list("pending") };
  if (status === "all") return { questions: queue.list() };
  return { questions: queue.list(status) };
}

function answerOwnerQuestionLocal(
  queue: OwnerQuestionQueue,
  id: string,
  answer: string,
): PendingOwnerQuestion | null {
  return queue.answer(id, answer, RESOLUTION_SOURCE);
}

function dismissOwnerQuestionLocal(
  queue: OwnerQuestionQueue,
  id: string,
  reason?: string,
): PendingOwnerQuestion | null {
  return queue.dismiss(id, reason, RESOLUTION_SOURCE);
}

async function readAnswerField(req: IncomingMessage): Promise<string> {
  try {
    const body = await readBody(req);
    return typeof body.answer === "string" ? body.answer : "";
  } catch {
    return "";
  }
}

async function readReasonField(req: IncomingMessage): Promise<string | undefined> {
  try {
    const body = await readBody(req);
    return typeof body.reason === "string" ? body.reason : undefined;
  } catch {
    return undefined;
  }
}

export async function handleListOwnerQuestions(
  res: ServerResponse,
  queue?: OwnerQuestionQueue,
  status?: OwnerQuestionStatus | "all",
  selector?: ScopeSelectorArgument,
  getScopeProvider?: OwnerQuestionScopeProviderResolver,
): Promise<void> {
  const resolvedQueue = resolveOwnerQuestionQueue(res, queue, selector, getScopeProvider);
  if (!resolvedQueue) return;
  jsonResponse(res, 200, listOwnerQuestionsLocal(resolvedQueue, status));
}

export async function handleAnswerOwnerQuestion(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  queue?: OwnerQuestionQueue,
  selector?: ScopeSelectorArgument,
  getScopeProvider?: OwnerQuestionScopeProviderResolver,
): Promise<void> {
  const answer = await readAnswerField(req);
  if (!answer.trim()) {
    jsonResponse(res, 400, { error: "answer is required" });
    return;
  }
  const resolvedQueue = resolveOwnerQuestionQueue(res, queue, selector, getScopeProvider);
  if (!resolvedQueue) return;
  const item = answerOwnerQuestionLocal(resolvedQueue, id, answer);
  if (!item) {
    jsonResponse(res, 404, { error: "Owner question not found or already resolved" });
    return;
  }
  jsonResponse(res, 200, { question: item });
}

export async function handleDismissOwnerQuestion(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  queue?: OwnerQuestionQueue,
  selector?: ScopeSelectorArgument,
  getScopeProvider?: OwnerQuestionScopeProviderResolver,
): Promise<void> {
  const reason = await readReasonField(req);
  const resolvedQueue = resolveOwnerQuestionQueue(res, queue, selector, getScopeProvider);
  if (!resolvedQueue) return;
  const item = dismissOwnerQuestionLocal(resolvedQueue, id, reason);
  if (!item) {
    jsonResponse(res, 404, { error: "Owner question not found or already resolved" });
    return;
  }
  jsonResponse(res, 200, { question: item });
}

export function ownerQuestionRoutes(
  getScopeProvider?: OwnerQuestionScopeProviderResolver,
): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/owner-questions",
      handler: (req, res) => {
        const selector = readScopeSelectorQueryOrErrorResponse(req, res);
        if (selector === null) return;
        return handleListOwnerQuestions(
          res,
          undefined,
          readOwnerQuestionStatusFilter(req),
          selector,
          getScopeProvider,
        );
      },
    },
    {
      method: "POST",
      path: "/api/owner-questions/:id/answer",
      handler: (req, res, params) => {
        const selector = readScopeSelectorQueryOrErrorResponse(req, res);
        if (selector === null) return;
        return handleAnswerOwnerQuestion(
          req,
          res,
          params.id,
          undefined,
          selector,
          getScopeProvider,
        );
      },
    },
    {
      method: "POST",
      path: "/api/owner-questions/:id/dismiss",
      handler: (req, res, params) => {
        const selector = readScopeSelectorQueryOrErrorResponse(req, res);
        if (selector === null) return;
        return handleDismissOwnerQuestion(
          req,
          res,
          params.id,
          undefined,
          selector,
          getScopeProvider,
        );
      },
    },
  ];
}

async function handleListOwnerQuestionsControl(
  req: IncomingMessage,
  res: ServerResponse,
  getScopeProvider?: OwnerQuestionScopeProviderResolver,
): Promise<void> {
  const selector = readScopeSelectorQueryOrErrorResponse(req, res);
  if (selector === null) return;
  const queue = resolveOwnerQuestionQueue(res, undefined, selector, getScopeProvider);
  if (!queue) return;
  jsonResponse(
    res,
    200,
    listOwnerQuestionsLocal(queue, readOwnerQuestionStatusFilter(req)),
  );
}

async function handleAnswerOwnerQuestionControl(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  getScopeProvider?: OwnerQuestionScopeProviderResolver,
): Promise<void> {
  const answer = await readAnswerField(req);
  if (!answer.trim()) {
    jsonResponse(res, 400, { error: "answer is required" });
    return;
  }
  const selector = readScopeSelectorQueryOrErrorResponse(req, res);
  if (selector === null) return;
  const queue = resolveOwnerQuestionQueue(res, undefined, selector, getScopeProvider);
  if (!queue) return;
  const item = answerOwnerQuestionLocal(queue, params.id, answer);
  if (!item) {
    jsonResponse(res, 404, { error: "Owner question not found or already resolved" });
    return;
  }
  jsonResponse(res, 200, { question: item });
}

async function handleDismissOwnerQuestionControl(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  getScopeProvider?: OwnerQuestionScopeProviderResolver,
): Promise<void> {
  const reason = await readReasonField(req);
  const selector = readScopeSelectorQueryOrErrorResponse(req, res);
  if (selector === null) return;
  const queue = resolveOwnerQuestionQueue(res, undefined, selector, getScopeProvider);
  if (!queue) return;
  const item = dismissOwnerQuestionLocal(queue, params.id, reason);
  if (!item) {
    jsonResponse(res, 404, { error: "Owner question not found or already resolved" });
    return;
  }
  jsonResponse(res, 200, { question: item });
}

export function ownerQuestionControlRoutes(
  getScopeProvider?: OwnerQuestionScopeProviderResolver,
): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/owner-questions",
      capabilityScope: "read",
      handler: (req, res) => handleListOwnerQuestionsControl(req, res, getScopeProvider),
    },
    {
      method: "POST",
      path: "/owner-questions/:id/answer",
      capabilityScope: "control",
      handler: (req, res, params) =>
        handleAnswerOwnerQuestionControl(req, res, params, getScopeProvider),
    },
    {
      method: "POST",
      path: "/owner-questions/:id/dismiss",
      capabilityScope: "control",
      handler: (req, res, params) =>
        handleDismissOwnerQuestionControl(req, res, params, getScopeProvider),
    },
  ];
}
