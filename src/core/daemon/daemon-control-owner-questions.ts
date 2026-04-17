import type { IncomingMessage, ServerResponse } from "node:http";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import { jsonResponse, readBody } from "./daemon-control-utils.js";

export function handleListOwnerQuestions(handle: DaemonControlHandle, res: ServerResponse): void {
  jsonResponse(res, 200, { questions: handle.listOwnerQuestions() });
}

export function handleAnswerOwnerQuestion(
  handle: DaemonControlHandle,
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  readBody(req)
    .then((buf) => {
      let answer = "";
      try {
        const body = JSON.parse(buf.toString()) as Record<string, unknown>;
        answer = typeof body.answer === "string" ? body.answer : "";
      } catch {
        // handled below
      }
      if (!answer.trim()) {
        jsonResponse(res, 400, { error: "answer is required" });
        return;
      }
      const item = handle.answerOwnerQuestion(params.id, answer);
      if (!item) {
        jsonResponse(res, 404, { error: "Owner question not found or already resolved" });
        return;
      }
      jsonResponse(res, 200, { question: item });
    })
    .catch(() => jsonResponse(res, 500, { error: "Internal error" }));
}

export function handleDismissOwnerQuestion(
  handle: DaemonControlHandle,
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  readBody(req)
    .then((buf) => {
      let reason: string | undefined;
      try {
        const body = JSON.parse(buf.toString()) as Record<string, unknown>;
        reason = typeof body.reason === "string" ? body.reason : undefined;
      } catch {
        // reason is optional
      }
      const item = handle.dismissOwnerQuestion(params.id, reason);
      if (!item) {
        jsonResponse(res, 404, { error: "Owner question not found or already resolved" });
        return;
      }
      jsonResponse(res, 200, { question: item });
    })
    .catch(() => jsonResponse(res, 500, { error: "Internal error" }));
}
