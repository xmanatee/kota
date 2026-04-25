import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getOwnerQuestionQueue,
  type OwnerQuestionQueue,
  type OwnerQuestionStatus,
  type PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";

const RESOLUTION_SOURCE = "http";

const VALID_STATUSES: readonly (OwnerQuestionStatus | "all")[] = [
  "all",
  "pending",
  "answered",
  "dismissed",
  "expired",
];

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
  queue: OwnerQuestionQueue = getOwnerQuestionQueue(),
  status?: OwnerQuestionStatus | "all",
): Promise<void> {
  jsonResponse(res, 200, listOwnerQuestionsLocal(queue, status));
}

export async function handleAnswerOwnerQuestion(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  queue: OwnerQuestionQueue = getOwnerQuestionQueue(),
): Promise<void> {
  const answer = await readAnswerField(req);
  if (!answer.trim()) {
    jsonResponse(res, 400, { error: "answer is required" });
    return;
  }
  const item = answerOwnerQuestionLocal(queue, id, answer);
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
  queue: OwnerQuestionQueue = getOwnerQuestionQueue(),
): Promise<void> {
  const reason = await readReasonField(req);
  const item = dismissOwnerQuestionLocal(queue, id, reason);
  if (!item) {
    jsonResponse(res, 404, { error: "Owner question not found or already resolved" });
    return;
  }
  jsonResponse(res, 200, { question: item });
}

const OWNER_QUESTION_ACTION_PATTERN = /^\/api\/owner-questions\/([^/]+)\/(answer|dismiss)$/;

export function ownerQuestionRoutes(): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/owner-questions",
      handler: (req, res) =>
        handleListOwnerQuestions(res, undefined, readOwnerQuestionStatusFilter(req)),
    },
    {
      method: "POST",
      path: "/api/owner-questions/",
      pathPattern: OWNER_QUESTION_ACTION_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url!, "http://localhost").pathname.match(OWNER_QUESTION_ACTION_PATTERN);
        const id = match![1];
        const action = match![2];
        if (action === "answer") {
          return handleAnswerOwnerQuestion(req, res, id);
        }
        return handleDismissOwnerQuestion(req, res, id);
      },
    },
  ];
}

async function handleListOwnerQuestionsControl(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  jsonResponse(
    res,
    200,
    listOwnerQuestionsLocal(getOwnerQuestionQueue(), readOwnerQuestionStatusFilter(req)),
  );
}

async function handleAnswerOwnerQuestionControl(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): Promise<void> {
  const answer = await readAnswerField(req);
  if (!answer.trim()) {
    jsonResponse(res, 400, { error: "answer is required" });
    return;
  }
  const item = answerOwnerQuestionLocal(getOwnerQuestionQueue(), params.id, answer);
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
): Promise<void> {
  const reason = await readReasonField(req);
  const item = dismissOwnerQuestionLocal(getOwnerQuestionQueue(), params.id, reason);
  if (!item) {
    jsonResponse(res, 404, { error: "Owner question not found or already resolved" });
    return;
  }
  jsonResponse(res, 200, { question: item });
}

export function ownerQuestionControlRoutes(): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/owner-questions",
      capabilityScope: "read",
      handler: handleListOwnerQuestionsControl,
    },
    {
      method: "POST",
      path: "/owner-questions/:id/answer",
      capabilityScope: "control",
      handler: handleAnswerOwnerQuestionControl,
    },
    {
      method: "POST",
      path: "/owner-questions/:id/dismiss",
      capabilityScope: "control",
      handler: handleDismissOwnerQuestionControl,
    },
  ];
}
