import { Command } from "commander";
import {
  getOwnerDecisionStore,
  type OwnerDecisionSelectedValue,
  type OwnerDecisionStore,
} from "#core/daemon/owner-decision-store.js";
import {
  getOwnerQuestionQueue,
  type OwnerQuestionQueue,
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
import { registerOwnerDecisionCommands } from "./cli.js";
import type {
  OwnerDecisionListFilter,
  OwnerDecisionMutateResult,
  OwnerDecisionScopeSelection,
  OwnerDecisionShowResult,
  OwnerDecisionsClient,
} from "./client.js";
import {
  answerOwnerDecisionLocal,
  cancelOwnerDecisionLocal,
  listOwnerDecisionsLocal,
  showOwnerDecisionLocal,
} from "./operations.js";
import { ownerDecisionControlRoutes, ownerDecisionRoutes } from "./routes.js";

export type {
  OwnerConfirmedActionMetadata,
  OwnerDecisionClientProjection,
  OwnerDecisionRecord,
  OwnerDecisionRequest,
  OwnerDecisionSelectedValue,
  OwnerDecisionStatus,
} from "#core/daemon/owner-decision-store.js";
export {
  getOwnerDecisionStore,
  OwnerDecisionStore,
  projectOwnerDecisionForClient,
  resetOwnerDecisionStore,
} from "#core/daemon/owner-decision-store.js";

const RESOLUTION_SOURCE = "cli";

type OwnerDecisionQueues = {
  decisionStore: OwnerDecisionStore;
  questionQueue: OwnerQuestionQueue;
};

type OwnerDecisionRouteError = {
  error?: string;
  reason?: string;
  scopeId?: string;
};

function resolveLocalQueues(selector?: ScopeSelector): OwnerDecisionQueues {
  const scopeProvider = getProviderRegistry()?.get(DAEMON_SCOPE_PROVIDER_TYPE);
  if (!scopeProvider) {
    return {
      decisionStore: getOwnerDecisionStore(),
      questionQueue: getOwnerQuestionQueue(),
    };
  }
  const scopeId = selectedScopeSelectorId(selector);
  const resolved = scopeProvider.resolveScopeRuntime(scopeId);
  if (!resolved.ok) throw new Error(`Unknown scope: ${resolved.error.scopeId}`);
  return {
    decisionStore: resolved.runtime.ownerDecisionStore,
    questionQueue: resolved.runtime.ownerQuestionQueue,
  };
}

function listPath(filter?: OwnerDecisionListFilter): string {
  const params = new URLSearchParams();
  if (filter?.status) params.set("status", filter.status);
  appendScopeSelector(params, filter);
  const query = encodeQueryParams(params);
  return query ? `/owner-decisions?${query}` : "/owner-decisions";
}

function scopeQuery(scopeSelector?: OwnerDecisionScopeSelection): string {
  return scopeSelectorQuery(scopeSelector);
}

async function readRouteError(res: Response): Promise<OwnerDecisionRouteError | null> {
  try {
    const parsed = (await res.json()) as OwnerDecisionRouteError;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

async function mutateOwnerDecision(
  link: DaemonTransport,
  path: string,
  body: string,
): Promise<OwnerDecisionMutateResult> {
  const res = await link.fetchRaw(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (res.status === 404) {
    const errBody = await readRouteError(res);
    if (errBody?.reason === "unknown_scope" && errBody.scopeId) {
      throw new Error(`Unknown scope: ${errBody.scopeId}`);
    }
    return { ok: false, reason: "not_found" };
  }
  if (!res.ok) {
    const errBody = await readRouteError(res);
    throw new Error(errBody?.error ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as Extract<OwnerDecisionMutateResult, { ok: true }>;
  return { ok: true, decision: data.decision };
}

function buildDaemonHandler(link: DaemonTransport): OwnerDecisionsClient {
  return {
    list: async (filter) => link.requestStrict("GET", listPath(filter)),
    show: async (id, scopeSelector): Promise<OwnerDecisionShowResult> => {
      const res = await link.fetchRaw(`/owner-decisions/${encodeURIComponent(id)}${scopeQuery(scopeSelector)}`);
      if (res.status === 404) return { found: false };
      if (!res.ok) {
        const errBody = await readRouteError(res);
        throw new Error(errBody?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as Extract<OwnerDecisionShowResult, { found: true }>;
      return { found: true, decision: data.decision };
    },
    answer: async (id, selectedValue, scopeSelector) =>
      mutateOwnerDecision(
        link,
        `/owner-decisions/${encodeURIComponent(id)}/answer${scopeQuery(scopeSelector)}`,
        JSON.stringify({ selectedValue }),
      ),
    cancel: async (id, reason, scopeSelector) =>
      mutateOwnerDecision(
        link,
        `/owner-decisions/${encodeURIComponent(id)}/cancel${scopeQuery(scopeSelector)}`,
        JSON.stringify({ reason }),
      ),
  };
}

function localHandler(): OwnerDecisionsClient {
  return {
    async list(filter) {
      const queues = resolveLocalQueues(filter);
      return listOwnerDecisionsLocal(queues.decisionStore, filter?.status);
    },
    async show(id, scopeSelector) {
      const queues = resolveLocalQueues(scopeSelector);
      const decision = showOwnerDecisionLocal(queues.decisionStore, id);
      return decision ? { found: true, decision } : { found: false };
    },
    async answer(id, selectedValue: OwnerDecisionSelectedValue, scopeSelector) {
      const queues = resolveLocalQueues(scopeSelector);
      const decision = answerOwnerDecisionLocal(
        queues.decisionStore,
        queues.questionQueue,
        id,
        selectedValue,
        RESOLUTION_SOURCE,
      );
      return decision ? { ok: true, decision } : { ok: false, reason: "not_found" };
    },
    async cancel(id, reason, scopeSelector) {
      const queues = resolveLocalQueues(scopeSelector);
      const decision = cancelOwnerDecisionLocal(
        queues.decisionStore,
        queues.questionQueue,
        id,
        reason,
        RESOLUTION_SOURCE,
      );
      return decision ? { ok: true, decision } : { ok: false, reason: "not_found" };
    },
  };
}

const ownerDecisionsModule: KotaModule = {
  name: "owner-decisions",
  version: "1.0.0",
  description: "Persisted owner-decision protocol operator surfaces",
  dependencies: ["rendering"],

  commands: (ctx) => {
    const root = new Command("__root__");
    registerOwnerDecisionCommands(root, ctx);
    return root.commands as Command[];
  },

  routes: () => ownerDecisionRoutes(),
  controlRoutes: () => ownerDecisionControlRoutes(),
  localClient: () => ({ ownerDecisions: localHandler() }),
  daemonClient: (link) => ({ ownerDecisions: buildDaemonHandler(link) }),
};

export default ownerDecisionsModule;
