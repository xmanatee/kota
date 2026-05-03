/**
 * Owner-questions module — exposes the `kota owner-question` operator CLI
 * and HTTP routes for the owner question queue. The queue state and review
 * gate live in `src/core/daemon/` as shared runtime primitives.
 */
import { Command } from "commander";
import {
  getOwnerQuestionQueue,
  type PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
import type { KotaModule } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { registerOwnerQuestionCommands } from "./cli.js";
import type {
  OwnerQuestionMutateResult,
  OwnerQuestionsClient,
  OwnerQuestionsListResult,
} from "./client.js";
import { ownerQuestionControlRoutes, ownerQuestionRoutes } from "./routes.js";

export type {
  OwnerQuestionEnqueueInput,
  OwnerQuestionStatus,
  PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
export {
  getOwnerQuestionQueue,
  OwnerQuestionQueue,
  resetOwnerQuestionQueue,
} from "#core/daemon/owner-question-queue.js";
export { reviewOwnerQuestion } from "#core/daemon/owner-question-review.js";

const RESOLUTION_SOURCE = "cli";

/**
 * Daemon-side `OwnerQuestionsClient` backed by the typed `DaemonTransport`.
 * Calls the same `/owner-questions`, `/owner-questions/:id/answer`, and
 * `/owner-questions/:id/dismiss` HTTP routes the daemon registers through
 * `ownerQuestionControlRoutes()`. The transport surface owns the bearer
 * token, base URL, and timeout policy — this factory only encodes the wire
 * shape and decodes the discriminated mutation envelope.
 *
 * `list` rides on `requestStrict<T>` so HTTP failures (5xx, network) throw
 * loudly rather than collapsing into an empty list. The mutations use
 * `fetchRaw` so a 404 from the route can be transformed into the typed
 * `{ ok: false, reason: "not_found" }` arm; every other non-OK status
 * surfaces as a thrown error and never masquerades as `not_found`.
 */
function buildOwnerQuestionsDaemonHandler(
  link: DaemonTransport,
): OwnerQuestionsClient {
  return {
    list: async (filter): Promise<OwnerQuestionsListResult> => {
      const status = filter?.status;
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      return link.requestStrict<OwnerQuestionsListResult>(
        "GET",
        `/owner-questions${query}`,
      );
    },
    answer: async (id, answer): Promise<OwnerQuestionMutateResult> =>
      mutateOwnerQuestion(
        link,
        `/owner-questions/${encodeURIComponent(id)}/answer`,
        JSON.stringify({ answer }),
      ),
    dismiss: async (id, reason): Promise<OwnerQuestionMutateResult> =>
      mutateOwnerQuestion(
        link,
        `/owner-questions/${encodeURIComponent(id)}/dismiss`,
        JSON.stringify(reason !== undefined ? { reason } : {}),
      ),
  };
}

async function mutateOwnerQuestion(
  link: DaemonTransport,
  path: string,
  body: string,
): Promise<OwnerQuestionMutateResult> {
  const res = await link.fetchRaw(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (res.status === 404) return { ok: false, reason: "not_found" };
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as { error?: string };
      if (typeof errBody.error === "string") detail = errBody.error;
    } catch {
      // body is not JSON; use HTTP status as the detail.
    }
    throw new Error(detail);
  }
  const data = (await res.json()) as { question: PendingOwnerQuestion };
  return { ok: true, question: data.question };
}

const ownerQuestionsModule: KotaModule = {
  name: "owner-questions",
  version: "1.0.0",
  description: "Owner-question queue operator CLI and HTTP routes for agent escalations",
  dependencies: ["rendering"],

  commands: (ctx) => {
    const root = new Command("__root__");
    registerOwnerQuestionCommands(root, ctx);
    return root.commands as Command[];
  },

  routes: () => ownerQuestionRoutes(),
  controlRoutes: () => ownerQuestionControlRoutes(),

  localClient: () => {
    const handler: OwnerQuestionsClient = {
      async list(filter) {
        const queue = getOwnerQuestionQueue();
        const status = filter?.status;
        if (status === undefined) return { questions: queue.list("pending") };
        if (status === "all") return { questions: queue.list() };
        return { questions: queue.list(status) };
      },
      async answer(id, answer) {
        const item = getOwnerQuestionQueue().answer(id, answer, RESOLUTION_SOURCE);
        return item ? { ok: true, question: item } : { ok: false, reason: "not_found" };
      },
      async dismiss(id, reason) {
        const item = getOwnerQuestionQueue().dismiss(id, reason, RESOLUTION_SOURCE);
        return item ? { ok: true, question: item } : { ok: false, reason: "not_found" };
      },
    };
    return { ownerQuestions: handler };
  },

  daemonClient: (link) => ({ ownerQuestions: buildOwnerQuestionsDaemonHandler(link) }),
};

export default ownerQuestionsModule;
