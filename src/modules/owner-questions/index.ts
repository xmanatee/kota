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
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import type { KotaModule } from "#core/modules/module-types.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import {
  appendScopeSelector,
  encodeQueryParams,
  type ScopeSelector,
  scopeSelectorQuery,
  selectedScopeSelectorId,
} from "#core/server/scope-selector.js";
import { registerOwnerQuestionCommands } from "./cli.js";
import type {
  OwnerQuestionListFilter,
  OwnerQuestionMutateResult,
  OwnerQuestionScopeSelection,
  OwnerQuestionsClient,
  OwnerQuestionsListResult,
} from "./client.js";
import { ownerQuestionControlRoutes, ownerQuestionRoutes } from "./routes.js";
import { ownerQuestionsUiSurfaceSource } from "./ui-surface.js";

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

function resolveLocalOwnerQuestionQueue(selector?: ScopeSelector): OwnerQuestionQueue {
  const scopeProvider = getProviderRegistry()?.get(DAEMON_SCOPE_PROVIDER_TYPE);
  if (!scopeProvider) return getOwnerQuestionQueue();
  const scopeId = selectedScopeSelectorId(selector);
  const resolved = scopeProvider.resolveScopeRuntime(scopeId);
  if (!resolved.ok) {
    throw new Error(`Unknown scope: ${resolved.error.scopeId}`);
  }
  return resolved.runtime.ownerQuestionQueue;
}

function ownerQuestionsListPath(filter?: OwnerQuestionListFilter): string {
  const params = new URLSearchParams();
  if (filter?.status) params.set("status", filter.status);
  appendScopeSelector(params, filter);
  const query = encodeQueryParams(params);
  return query ? `/owner-questions?${query}` : "/owner-questions";
}

function ownerQuestionScopeQuery(scopeSelector?: OwnerQuestionScopeSelection): string {
  return scopeSelectorQuery(scopeSelector);
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
    answer: async (id, answer, scopeSelector): Promise<OwnerQuestionMutateResult> =>
      mutateOwnerQuestion(
        link,
        `/owner-questions/${encodeURIComponent(id)}/answer${ownerQuestionScopeQuery(scopeSelector)}`,
        JSON.stringify({ answer }),
      ),
    dismiss: async (id, reason, scopeSelector): Promise<OwnerQuestionMutateResult> =>
      mutateOwnerQuestion(
        link,
        `/owner-questions/${encodeURIComponent(id)}/dismiss${ownerQuestionScopeQuery(scopeSelector)}`,
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
    if (errBody?.reason === "unknown_scope" && errBody.scopeId) {
      throw new Error(`Unknown scope: ${errBody.scopeId}`);
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
  scopeId?: string;
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
  uiSurfaces: [ownerQuestionsUiSurfaceSource],

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
        const queue = resolveLocalOwnerQuestionQueue(filter);
        const status = filter?.status;
        if (status === undefined) return { questions: queue.list("pending") };
        if (status === "all") return { questions: queue.list() };
        return { questions: queue.list(status) };
      },
      async answer(id, answer, scopeSelector) {
        const item = resolveLocalOwnerQuestionQueue(scopeSelector).answer(id, answer, RESOLUTION_SOURCE);
        return item ? { ok: true, question: item } : { ok: false, reason: "not_found" };
      },
      async dismiss(id, reason, scopeSelector) {
        const item = resolveLocalOwnerQuestionQueue(scopeSelector).dismiss(id, reason, RESOLUTION_SOURCE);
        return item ? { ok: true, question: item } : { ok: false, reason: "not_found" };
      },
    };
    return { ownerQuestions: handler };
  },

  daemonClient: (link) => ({ ownerQuestions: buildOwnerQuestionsDaemonHandler(link) }),
};

export default ownerQuestionsModule;
