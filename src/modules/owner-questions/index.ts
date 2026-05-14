/**
 * Owner-questions module — exposes the `kota owner-question` operator CLI
 * and HTTP routes for the owner question queue. The queue state and review
 * gate live in `src/core/daemon/` as shared runtime primitives.
 */
import { Command } from "commander";
import {
  getOwnerQuestionQueue,
  type OwnerQuestionQueue,
  type PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import type { KotaModule } from "#core/modules/module-types.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { registerOwnerQuestionCommands } from "./cli.js";
import type {
  OwnerQuestionMutateResult,
  OwnerQuestionProjectScope,
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

function resolveLocalOwnerQuestionQueue(projectId?: string): OwnerQuestionQueue {
  const projectScope = getProviderRegistry()?.get(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE);
  if (!projectScope) return getOwnerQuestionQueue();
  const resolved = projectScope.resolveProjectRuntime(projectId);
  if (!resolved.ok) {
    throw new Error(`Unknown project: ${resolved.error.projectId}`);
  }
  return resolved.runtime.ownerQuestionQueue;
}

function ownerQuestionsListPath(filter?: { status?: string; projectId?: string }): string {
  const params: string[] = [];
  if (filter?.status) params.push(`status=${encodeURIComponent(filter.status)}`);
  if (filter?.projectId) params.push(`projectId=${encodeURIComponent(filter.projectId)}`);
  const query = params.join("&");
  return query ? `/owner-questions?${query}` : "/owner-questions";
}

function ownerQuestionProjectQuery(project?: OwnerQuestionProjectScope): string {
  if (!project?.projectId) return "";
  const params = new URLSearchParams();
  params.set("projectId", project.projectId);
  return `?${params.toString()}`;
}

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
      return link.requestStrict<OwnerQuestionsListResult>(
        "GET",
        ownerQuestionsListPath(filter),
      );
    },
    answer: async (id, answer, project): Promise<OwnerQuestionMutateResult> =>
      mutateOwnerQuestion(
        link,
        `/owner-questions/${encodeURIComponent(id)}/answer${ownerQuestionProjectQuery(project)}`,
        JSON.stringify({ answer }),
      ),
    dismiss: async (id, reason, project): Promise<OwnerQuestionMutateResult> =>
      mutateOwnerQuestion(
        link,
        `/owner-questions/${encodeURIComponent(id)}/dismiss${ownerQuestionProjectQuery(project)}`,
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
  if (res.status === 404) {
    const errBody = await readOwnerQuestionRouteError(res);
    if (errBody?.reason === "unknown_project" && errBody.projectId) {
      throw new Error(`Unknown project: ${errBody.projectId}`);
    }
    return { ok: false, reason: "not_found" };
  }
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

type OwnerQuestionRouteErrorBody = {
  error?: string;
  reason?: string;
  projectId?: string;
};

async function readOwnerQuestionRouteError(
  res: Response,
): Promise<OwnerQuestionRouteErrorBody | null> {
  try {
    const parsed = (await res.json()) as OwnerQuestionRouteErrorBody;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
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
        const queue = resolveLocalOwnerQuestionQueue(filter?.projectId);
        const status = filter?.status;
        if (status === undefined) return { questions: queue.list("pending") };
        if (status === "all") return { questions: queue.list() };
        return { questions: queue.list(status) };
      },
      async answer(id, answer, project) {
        const item = resolveLocalOwnerQuestionQueue(project?.projectId).answer(id, answer, RESOLUTION_SOURCE);
        return item ? { ok: true, question: item } : { ok: false, reason: "not_found" };
      },
      async dismiss(id, reason, project) {
        const item = resolveLocalOwnerQuestionQueue(project?.projectId).dismiss(id, reason, RESOLUTION_SOURCE);
        return item ? { ok: true, question: item } : { ok: false, reason: "not_found" };
      },
    };
    return { ownerQuestions: handler };
  },

  daemonClient: (link) => ({ ownerQuestions: buildOwnerQuestionsDaemonHandler(link) }),
};

export default ownerQuestionsModule;
