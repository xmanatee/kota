import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getOwnerQuestionQueue,
  type OwnerQuestionQueue,
  type PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";

const RESOLUTION_SOURCE = "http";

function listOwnerQuestionsLocal(
  queue: OwnerQuestionQueue,
): { questions: PendingOwnerQuestion[] } {
  return { questions: queue.list("pending") };
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
): Promise<void> {
  jsonResponse(res, 200, listOwnerQuestionsLocal(queue));
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
      handler: (_req, res) => handleListOwnerQuestions(res),
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
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  jsonResponse(res, 200, listOwnerQuestionsLocal(getOwnerQuestionQueue()));
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
