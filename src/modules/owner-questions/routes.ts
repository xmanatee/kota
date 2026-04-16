import type { IncomingMessage, ServerResponse } from "node:http";
import { getOwnerQuestionQueue, type OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";

export async function handleListOwnerQuestions(
  res: ServerResponse,
  queue: OwnerQuestionQueue = getOwnerQuestionQueue(),
): Promise<void> {
  jsonResponse(res, 200, { questions: queue.list("pending") });
}

export async function handleAnswerOwnerQuestion(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  queue: OwnerQuestionQueue = getOwnerQuestionQueue(),
): Promise<void> {
  let answer = "";
  try {
    const body = await readBody(req);
    answer = typeof body.answer === "string" ? body.answer : "";
  } catch {
    // handled below
  }
  if (!answer.trim()) {
    jsonResponse(res, 400, { error: "answer is required" });
    return;
  }
  const item = queue.answer(id, answer, "http");
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
  let reason: string | undefined;
  try {
    const body = await readBody(req);
    reason = typeof body.reason === "string" ? body.reason : undefined;
  } catch {
    // reason is optional
  }
  const item = queue.dismiss(id, reason, "http");
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
