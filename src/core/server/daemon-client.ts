import type { ApprovalStatus, PendingApproval } from "#core/daemon/approval-queue.js";
import type { CapabilityReadinessResponse } from "#core/daemon/capability-readiness.js";
import type { ClientIdentity } from "#core/daemon/client-identity.js";
import type {
  DaemonControlAddress,
  DaemonLiveStatus,
  DaemonSseEvent,
  HealthStatus,
  WorkflowDefinitionSummary,
  WorkflowLiveStatus,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "#core/daemon/daemon-control.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { type DaemonTransport, daemonTransportFromAddress } from "./daemon-transport.js";
import type {
  KotaClient,
  RepoTaskCaptureResult,
  RepoTaskCreateOptions,
  RepoTaskCreateResult,
  RepoTaskGcOptions,
  RepoTaskGcResult,
  RepoTaskListEntry,
  RepoTaskMoveResult,
  RepoTaskReindexResult,
  RepoTaskSearchFilter,
  RepoTaskSearchResult,
  RepoTaskShowResult,
  RepoTaskState,
  WorkflowTriggerOptions,
} from "./kota-client.js";
import {
  type DaemonClientHandlers,
  KOTA_CLIENT_NAMESPACES,
  type KotaClientNamespace,
} from "./kota-client.js";

const REPO_TASK_OPEN_STATES: RepoTaskState[] = [
  "backlog",
  "ready",
  "doing",
  "blocked",
];

const FETCH_TIMEOUT_MS = 2_000;

/**
 * Daemon `/workflow/trigger` only accepts a `payload` object that the
 * runtime spreads into the run's trigger payload. The daemon imposes its own
 * `event` ("manual") and `_runId` (generated server-side), so the CLI-side
 * `event`, `runId`, `force`, and `notBeforeMs` options on
 * `WorkflowTriggerOptions` are honored only on the daemon-down enqueue path.
 * The HTTP request carries the user-extension payload alone.
 */
function buildTriggerHttpPayload(
  options: WorkflowTriggerOptions | undefined,
): Record<string, unknown> | undefined {
  if (!options?.payload) return undefined;
  return Object.keys(options.payload).length > 0 ? options.payload : undefined;
}

function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * Fetch through the typed link, swallowing transport errors and returning
 * null on network failure. Used by methods that distinguish between several
 * HTTP status codes (e.g. 404 vs 409) where the link's `request<T>` shape
 * (which only returns `T | null`) is too narrow.
 */
async function safeFetchRaw(
  link: DaemonTransport,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response | null> {
  try {
    return await link.fetchRaw(path, {
      method,
      ...(body !== undefined && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers — transport-bound free functions used by the core stub
// closures and by `DaemonControlClient` public class methods. They take a
// `DaemonTransport` and call its `baseUrl` / `authHeaders()` / `fetchRaw()`
// directly so closures can be assembled without a class instance.
// ---------------------------------------------------------------------------

async function showTaskHttp(
  transport: DaemonTransport,
  id: string,
): Promise<RepoTaskShowResult> {
  const res = await fetchWithTimeout(
    `${transport.baseUrl}/api/tasks/${encodeURIComponent(id)}`,
    { headers: transport.authHeaders() },
  );
  if (res.status === 404) return { found: false };
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { state: RepoTaskState; content: string };
  return { found: true, state: body.state, content: body.content };
}

async function moveTaskHttp(
  transport: DaemonTransport,
  id: string,
  toState: RepoTaskState,
): Promise<RepoTaskMoveResult> {
  const res = await fetchWithTimeout(
    `${transport.baseUrl}/api/tasks/${encodeURIComponent(id)}/move`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...transport.authHeaders() },
      body: JSON.stringify({ state: toState }),
    },
  );
  if (res.status === 404) return { ok: false, reason: "not_found" };
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { state?: RepoTaskState };
    return { ok: false, reason: "already_in_state", state: body.state ?? toState };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    id: string;
    fromState: RepoTaskState;
    toState: RepoTaskState;
    path: string;
    previousPath: string;
  };
  return {
    ok: true,
    id: body.id,
    fromState: body.fromState,
    toState: body.toState,
    path: body.path,
    previousPath: body.previousPath,
  };
}

async function createTaskHttp(
  transport: DaemonTransport,
  options: RepoTaskCreateOptions,
): Promise<RepoTaskCreateResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/api/tasks/normalized`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...transport.authHeaders() },
    body: JSON.stringify(options),
  });
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, reason: "already_exists", message: body.error };
  }
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
    const reason = body.reason === "invalid_slug" ? "invalid_slug" : "invalid_slug";
    return { ok: false, reason, message: body.error };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { id: string; path: string };
  return { ok: true, id: body.id, path: body.path };
}

async function captureTaskHttp(
  transport: DaemonTransport,
  title: string,
): Promise<RepoTaskCaptureResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/api/tasks/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...transport.authHeaders() },
    body: JSON.stringify({ title }),
  });
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, reason: "already_exists", message: body.error };
  }
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, reason: "invalid_slug", message: body.error };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { id: string; path: string };
  return { ok: true, id: body.id, path: body.path };
}

async function gcTasksHttp(
  transport: DaemonTransport,
  options: RepoTaskGcOptions,
): Promise<RepoTaskGcResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/api/tasks/gc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...transport.authHeaders() },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as RepoTaskGcResult;
}

async function searchTasksHttp(
  transport: DaemonTransport,
  query: string,
  filter?: RepoTaskSearchFilter,
): Promise<RepoTaskSearchResult> {
  const params = new URLSearchParams();
  params.set("q", query);
  if (filter?.semantic === false) params.set("semantic", "false");
  if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
  if (filter?.states) {
    for (const state of filter.states) params.append("state", state);
  }
  const res = await fetchWithTimeout(
    `${transport.baseUrl}/tasks/search?${params.toString()}`,
    { headers: transport.authHeaders() },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as RepoTaskSearchResult;
}

async function reindexTasksHttp(
  transport: DaemonTransport,
): Promise<RepoTaskReindexResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/tasks/reindex`, {
    method: "POST",
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as RepoTaskReindexResult;
}

async function listTasksHttp(
  transport: DaemonTransport,
): Promise<
  | {
      counts: Record<string, number>;
      tasks: Record<string, { id: string; title: string; priority: string; area: string; summary: string; body: string }[]>;
    }
  | null
> {
  try {
    const res = await fetchWithTimeout(`${transport.baseUrl}/api/tasks`, {
      headers: transport.authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      counts: Record<string, number>;
      tasks: Record<string, { id: string; title: string; priority: string; area: string; summary: string; body: string }[]>;
    };
  } catch {
    return null;
  }
}

// Transport-bound wrappers around `transport.request<T>` / `safeFetchRaw`.
// Used by both class methods and stub closures.

function getHealthHttp(
  transport: DaemonTransport,
): Promise<{ status: string; components: HealthStatus } | null> {
  return transport.request("GET", "/health");
}

function getDaemonStatusHttp(
  transport: DaemonTransport,
): Promise<DaemonLiveStatus | null> {
  return transport.request("GET", "/status");
}

function getCapabilitiesHttp(
  transport: DaemonTransport,
): Promise<CapabilityReadinessResponse | null> {
  return transport.request("GET", "/capabilities");
}

function getIdentityHttp(
  transport: DaemonTransport,
): Promise<ClientIdentity | null> {
  return transport.request("GET", "/identity");
}

function getWorkflowStatusHttp(
  transport: DaemonTransport,
): Promise<WorkflowLiveStatus | null> {
  return transport.request("GET", "/workflow/status");
}

function getWorkflowDefinitionsHttp(
  transport: DaemonTransport,
): Promise<{ definitions: WorkflowDefinitionSummary[] } | null> {
  return transport.request("GET", "/workflow/definitions");
}

function pauseHttp(
  transport: DaemonTransport,
): Promise<{ ok: boolean; paused: boolean; already?: boolean } | null> {
  return transport.request("POST", "/workflow/pause");
}

function resumeHttp(
  transport: DaemonTransport,
): Promise<{ ok: boolean; paused: boolean; already?: boolean } | null> {
  return transport.request("POST", "/workflow/resume");
}

function abortHttp(
  transport: DaemonTransport,
): Promise<{ ok: boolean; aborted: number } | null> {
  return transport.request("POST", "/workflow/abort");
}

function reloadHttp(
  transport: DaemonTransport,
): Promise<{ ok: boolean; count: number } | null> {
  return transport.request("POST", "/workflow/reload");
}

function reloadConfigHttp(
  transport: DaemonTransport,
): Promise<{ ok: boolean; workflows: number; changedModules: string[] } | null> {
  return transport.request("POST", "/reload");
}

async function enableWorkflowHttp(
  transport: DaemonTransport,
  name: string,
): Promise<{ ok: boolean; notFound?: boolean } | null> {
  const resp = await safeFetchRaw(transport, "POST", `/workflow/definitions/${encodeURIComponent(name)}/enable`);
  if (!resp) return null;
  if (resp.status === 404) return { ok: false, notFound: true };
  if (!resp.ok) return null;
  return (await resp.json()) as { ok: boolean };
}

async function disableWorkflowHttp(
  transport: DaemonTransport,
  name: string,
): Promise<{ ok: boolean; notFound?: boolean } | null> {
  const resp = await safeFetchRaw(transport, "POST", `/workflow/definitions/${encodeURIComponent(name)}/disable`);
  if (!resp) return null;
  if (resp.status === 404) return { ok: false, notFound: true };
  if (!resp.ok) return null;
  return (await resp.json()) as { ok: boolean };
}

async function triggerWorkflowHttp(
  transport: DaemonTransport,
  name: string,
  tags?: string[],
  payload?: Record<string, unknown>,
): Promise<{ ok: boolean; queued?: string; runId?: string; alreadyQueued?: boolean } | null> {
  const resp = await safeFetchRaw(transport, "POST", "/workflow/trigger", {
    name,
    ...(tags && tags.length > 0 && { tags }),
    ...(payload && { payload }),
  });
  if (!resp) return null;
  if (resp.status === 409) return { ok: false, alreadyQueued: true };
  if (!resp.ok) return null;
  return (await resp.json()) as { ok: boolean; queued?: string; runId?: string };
}

async function abortRunHttp(
  transport: DaemonTransport,
  runId: string,
): Promise<{ ok: boolean; notFound?: boolean; queued?: boolean } | null> {
  const resp = await safeFetchRaw(transport, "POST", `/workflow/runs/${encodeURIComponent(runId)}/abort`);
  if (!resp) return null;
  if (resp.status === 404) return { ok: false, notFound: true };
  if (resp.status === 409) return { ok: false, queued: true };
  if (!resp.ok) return null;
  return (await resp.json()) as { ok: boolean };
}

async function cancelRunHttp(
  transport: DaemonTransport,
  runId: string,
): Promise<{ ok: boolean; notFound?: boolean; active?: boolean } | null> {
  const resp = await safeFetchRaw(transport, "DELETE", `/workflow/runs/${encodeURIComponent(runId)}`);
  if (!resp) return null;
  if (resp.status === 404) return { ok: false, notFound: true };
  if (resp.status === 409) return { ok: false, active: true };
  if (!resp.ok) return null;
  return (await resp.json()) as { ok: boolean };
}

function listWorkflowRunsHttp(
  transport: DaemonTransport,
  workflow?: string,
  limit?: number,
  tag?: string,
  causedByRunId?: string,
): Promise<{ runs: WorkflowRunSummary[] } | null> {
  const params = new URLSearchParams();
  if (workflow) params.set("workflow", workflow);
  if (limit !== undefined) params.set("limit", String(limit));
  if (tag) params.set("tag", tag);
  if (causedByRunId) params.set("causedByRunId", causedByRunId);
  const query = params.toString() ? `?${params.toString()}` : "";
  return transport.request("GET", `/workflow/runs${query}`);
}

function getWorkflowRunHttp(
  transport: DaemonTransport,
  id: string,
): Promise<WorkflowRunDetail | null> {
  return transport.request("GET", `/workflow/runs/${encodeURIComponent(id)}`);
}

/**
 * The OS-managed daemon flag is filesystem-scoped (it checks for a
 * launchd plist or systemd unit on the operator host). The daemon
 * cannot answer that for the calling host, so the daemon-up branch
 * always reports `false`; the local handler is the one that probes
 * the operator filesystem. Exported because the daemon-ops module's
 * `daemonClient(link)` factory consumes the same stub when it composes
 * the `daemonOps.status()` arm.
 */
export async function daemonManagedHttp(): Promise<boolean> {
  return false;
}

// ---------------------------------------------------------------------------
// Core stub: the namespace closures that have not yet migrated to their
// owning module's `daemonClient(link)` factory. Module-contributed handlers
// fill the gaps at assembly time. As each namespace migrates out, its
// closure is removed from the stub. The doctor pilot (2026-05-03) is the
// first namespace to leave; its handler is contributed by the doctor
// module instead.
// ---------------------------------------------------------------------------

/**
 * Build the core-side stub partial `DaemonClientHandlers` map from a typed
 * `DaemonTransport`. Each closure corresponds to a `KotaClient` namespace
 * that has not yet been migrated to its owning module. Migrated namespaces
 * are absent from the returned map and must be contributed by their owning
 * module's `daemonClient(link)` factory; missing handlers are a load-time
 * error in `assembleDaemonClientHandlers`, not a silent fallback.
 *
 * `kota serve` and `kota mcp-server` start a long-running process in the
 * caller's address space. The daemon cannot start either on the caller's
 * behalf, so the `web` and `mcpServer` namespaces surface
 * `daemon_required` uniformly when the selector picked the daemon
 * transport. The CLI maps that to a clear "stop the daemon first" hint.
 */
export function buildCoreStubDaemonClientHandlers(
  transport: DaemonTransport,
): Partial<DaemonClientHandlers> {
  return {
    workflow: {
      listRuns: async (filter) => {
        const result = await listWorkflowRunsHttp(
          transport,
          filter?.workflow,
          filter?.limit,
          filter?.tag,
          filter?.causedByRunId,
        );
        return { runs: result?.runs ?? [] };
      },
      status: async () => {
        const result = await getWorkflowStatusHttp(transport);
        if (!result) throw new Error("Daemon unreachable while reading workflow status");
        return { ...result, pendingAbort: false };
      },
      pause: async () => {
        const result = await pauseHttp(transport);
        if (!result) throw new Error("Daemon unreachable while pausing dispatch");
        return { paused: result.paused, already: result.already ?? false };
      },
      resume: async () => {
        const result = await resumeHttp(transport);
        if (!result) throw new Error("Daemon unreachable while resuming dispatch");
        return { paused: result.paused, already: result.already ?? false };
      },
      abort: async () => {
        const result = await abortHttp(transport);
        if (!result) throw new Error("Daemon unreachable while aborting active runs");
        return { status: "applied", count: result.aborted };
      },
      reload: async () => {
        const result = await reloadHttp(transport);
        if (!result) throw new Error("Daemon unreachable while reloading definitions");
        return { status: "applied", count: result.count };
      },
      enable: async (name) => {
        const result = await enableWorkflowHttp(transport, name);
        if (!result) throw new Error(`Daemon unreachable while enabling workflow "${name}"`);
        return result.notFound ? { ok: false, reason: "not_found" } : { ok: true };
      },
      disable: async (name) => {
        const result = await disableWorkflowHttp(transport, name);
        if (!result) throw new Error(`Daemon unreachable while disabling workflow "${name}"`);
        return result.notFound ? { ok: false, reason: "not_found" } : { ok: true };
      },
      cancelRun: async (id) => {
        const result = await cancelRunHttp(transport, id);
        if (!result) throw new Error(`Daemon unreachable while cancelling run "${id}"`);
        if (result.notFound) return { ok: false, reason: "not_found" };
        if (result.active) return { ok: false, reason: "active" };
        return { ok: true };
      },
      abortRun: async (id) => {
        const result = await abortRunHttp(transport, id);
        if (!result) throw new Error(`Daemon unreachable while aborting run "${id}"`);
        if (result.notFound) return { ok: false, reason: "not_found" };
        if (result.queued) return { ok: false, reason: "queued" };
        return { ok: true };
      },
      getRun: async (id) => {
        const run = await getWorkflowRunHttp(transport, id);
        return run ? { found: true, run } : { found: false };
      },
      listDefinitions: async () => {
        const result = await getWorkflowDefinitionsHttp(transport);
        if (!result) {
          throw new Error("Daemon unreachable while listing workflow definitions");
        }
        return { source: "daemon", definitions: result.definitions };
      },
      triggerByName: async (name, options) => {
        const result = await triggerWorkflowHttp(
          transport,
          name,
          options?.tags,
          buildTriggerHttpPayload(options),
        );
        if (!result) {
          throw new Error(`Daemon unreachable while triggering workflow "${name}"`);
        }
        if (result.alreadyQueued) return { ok: false, reason: "already_queued" };
        return {
          ok: true,
          path: "daemon",
          queued: result.queued ?? name,
          ...(result.runId !== undefined && { runId: result.runId }),
        };
      },
    },
    tasks: {
      list: async (states) => {
        const result = await listTasksHttp(transport);
        const wantedStates = states && states.length > 0 ? states : REPO_TASK_OPEN_STATES;
        const tasks: RepoTaskListEntry[] = [];
        if (result) {
          for (const state of wantedStates) {
            if (state === "done" || state === "dropped") {
              continue;
            }
            const stateTasks = result.tasks[state] ?? [];
            for (const task of stateTasks) {
              tasks.push({
                id: task.id,
                priority: task.priority,
                title: task.title,
                state,
              });
            }
          }
        }
        return { tasks };
      },
      show: async (id) => showTaskHttp(transport, id),
      move: async (id, toState) => moveTaskHttp(transport, id, toState),
      create: async (options) => createTaskHttp(transport, options),
      capture: async (title) => captureTaskHttp(transport, title),
      gc: async (options) => gcTasksHttp(transport, options ?? {}),
      search: async (query, filter) => searchTasksHttp(transport, query, filter),
      reindex: async () => reindexTasksHttp(transport),
    },
  };
}

/**
 * Assemble a complete `DaemonClientHandlers` map by overlaying contributed
 * module handlers on top of the core stub. Validates full coverage and
 * throws loudly when a namespace lacks a handler — there is no silent
 * fallback. Symmetric to the validation `LocalKotaClient` performs for
 * `LocalClientHandlers`.
 */
export function assembleDaemonClientHandlers(
  transport: DaemonTransport,
  contributed?: Partial<DaemonClientHandlers>,
): DaemonClientHandlers {
  const stub = buildCoreStubDaemonClientHandlers(transport);
  const merged: Partial<DaemonClientHandlers> = { ...stub, ...(contributed ?? {}) };
  const missing: KotaClientNamespace[] = [];
  for (const name of KOTA_CLIENT_NAMESPACES) {
    if (!merged[name]) missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(
      `DaemonControlClient is missing daemon handler(s) for: ${missing.join(", ")}. ` +
        `Each KotaClient namespace must be exposed by the core stub or by its owning ` +
        `module's daemonClient(link) factory at module load time.`,
    );
  }
  return merged as DaemonClientHandlers;
}

// ---------------------------------------------------------------------------
// DaemonControlClient — the daemon-online implementor of `KotaClient`.
// Namespace fields are populated from the assembled handlers map. Public
// non-namespace methods (`getHealth`, `events`, etc.) wrap the typed
// `DaemonTransport` directly.
// ---------------------------------------------------------------------------

export class DaemonControlClient implements KotaClient {
  readonly workflow: KotaClient["workflow"];
  readonly approvals: KotaClient["approvals"];
  readonly secrets: KotaClient["secrets"];
  readonly tasks: KotaClient["tasks"];
  readonly memory: KotaClient["memory"];
  readonly ownerQuestions: KotaClient["ownerQuestions"];
  readonly history: KotaClient["history"];
  readonly knowledge: KotaClient["knowledge"];
  readonly sessions: KotaClient["sessions"];
  readonly modules: KotaClient["modules"];
  readonly agents: KotaClient["agents"];
  readonly skills: KotaClient["skills"];
  readonly harnessParity: KotaClient["harnessParity"];
  readonly webhook: KotaClient["webhook"];
  readonly voice: KotaClient["voice"];
  readonly web: KotaClient["web"];
  readonly mcpServer: KotaClient["mcpServer"];
  readonly audit: KotaClient["audit"];
  readonly config: KotaClient["config"];
  readonly modulesAdmin: KotaClient["modulesAdmin"];
  readonly daemonOps: KotaClient["daemonOps"];
  readonly doctor: KotaClient["doctor"];
  readonly evalHarness: KotaClient["evalHarness"];
  readonly recall: KotaClient["recall"];
  readonly answer: KotaClient["answer"];
  readonly capture: KotaClient["capture"];
  readonly retract: KotaClient["retract"];

  private readonly transport: DaemonTransport;
  private readonly baseUrl: string;

  private constructor(transport: DaemonTransport, handlers: DaemonClientHandlers) {
    this.transport = transport;
    this.baseUrl = transport.baseUrl;
    this.workflow = handlers.workflow;
    this.approvals = handlers.approvals;
    this.secrets = handlers.secrets;
    this.tasks = handlers.tasks;
    this.memory = handlers.memory;
    this.ownerQuestions = handlers.ownerQuestions;
    this.history = handlers.history;
    this.knowledge = handlers.knowledge;
    this.sessions = handlers.sessions;
    this.modules = handlers.modules;
    this.agents = handlers.agents;
    this.skills = handlers.skills;
    this.harnessParity = handlers.harnessParity;
    this.webhook = handlers.webhook;
    this.voice = handlers.voice;
    this.web = handlers.web;
    this.mcpServer = handlers.mcpServer;
    this.audit = handlers.audit;
    this.config = handlers.config;
    this.modulesAdmin = handlers.modulesAdmin;
    this.daemonOps = handlers.daemonOps;
    this.doctor = handlers.doctor;
    this.evalHarness = handlers.evalHarness;
    this.recall = handlers.recall;
    this.answer = handlers.answer;
    this.capture = handlers.capture;
    this.retract = handlers.retract;
  }

  /**
   * Build a `DaemonControlClient` from a daemon address. Optional
   * `contributedHandlers` come from modules' `daemonClient(link)`
   * factories; they override the same namespace in the core stub. The
   * selector is the production caller; tests pass an address directly
   * with no contributed handlers and get a fully-stubbed client.
   */
  static fromAddress(
    address: DaemonControlAddress,
    contributedHandlers?: Partial<DaemonClientHandlers>,
  ): DaemonControlClient {
    const transport = daemonTransportFromAddress(address);
    return DaemonControlClient.fromTransport(transport, contributedHandlers);
  }

  /** Build a `DaemonControlClient` from an already-resolved transport. */
  static fromTransport(
    transport: DaemonTransport,
    contributedHandlers?: Partial<DaemonClientHandlers>,
  ): DaemonControlClient {
    const handlers = assembleDaemonClientHandlers(transport, contributedHandlers);
    return new DaemonControlClient(transport, handlers);
  }

  /**
   * Build a `DaemonControlClient` from an address using a factory that
   * derives the contributed handlers from the live transport. The factory
   * is what the module loader provides — its closure captures the loaded
   * modules' `daemonClient(link)` factories, which need a transport to
   * realize their handler maps. Used by long-lived consumers (e.g.
   * `DaemonLink`) that rebuild the client when the daemon identity
   * changes.
   */
  static fromAddressWithFactory(
    address: DaemonControlAddress,
    assembleDaemonHandlers: (
      transport: DaemonTransport,
    ) => Partial<DaemonClientHandlers>,
  ): DaemonControlClient {
    const transport = daemonTransportFromAddress(address);
    return DaemonControlClient.fromTransport(transport, assembleDaemonHandlers(transport));
  }

  // -------------------------------------------------------------------------
  // Non-namespace methods. These wrap the typed transport directly and are
  // consumed by callers that hold a `DaemonControlClient` (DaemonLink, the
  // server's daemon proxy routes, integration tests). They are not part of
  // any `KotaClient` namespace.
  // -------------------------------------------------------------------------

  getHealth(): Promise<{ status: string; components: HealthStatus } | null> {
    return getHealthHttp(this.transport);
  }

  getDaemonStatus(): Promise<DaemonLiveStatus | null> {
    return getDaemonStatusHttp(this.transport);
  }

  getCapabilities(): Promise<CapabilityReadinessResponse | null> {
    return getCapabilitiesHttp(this.transport);
  }

  getIdentity(): Promise<ClientIdentity | null> {
    return getIdentityHttp(this.transport);
  }

  getWorkflowStatus(): Promise<WorkflowLiveStatus | null> {
    return getWorkflowStatusHttp(this.transport);
  }

  getWorkflowDefinitions(): Promise<{ definitions: WorkflowDefinitionSummary[] } | null> {
    return getWorkflowDefinitionsHttp(this.transport);
  }

  pause(): Promise<{ ok: boolean; paused: boolean; already?: boolean } | null> {
    return pauseHttp(this.transport);
  }

  resume(): Promise<{ ok: boolean; paused: boolean; already?: boolean } | null> {
    return resumeHttp(this.transport);
  }

  abort(): Promise<{ ok: boolean; aborted: number } | null> {
    return abortHttp(this.transport);
  }

  reload(): Promise<{ ok: boolean; count: number } | null> {
    return reloadHttp(this.transport);
  }

  reloadConfig(): Promise<{ ok: boolean; workflows: number; changedModules: string[] } | null> {
    return reloadConfigHttp(this.transport);
  }

  enableWorkflow(name: string): Promise<{ ok: boolean; notFound?: boolean } | null> {
    return enableWorkflowHttp(this.transport, name);
  }

  disableWorkflow(name: string): Promise<{ ok: boolean; notFound?: boolean } | null> {
    return disableWorkflowHttp(this.transport, name);
  }

  trigger(name: string, tags?: string[], payload?: Record<string, unknown>): Promise<{ ok: boolean; queued?: string; runId?: string; alreadyQueued?: boolean } | null> {
    return triggerWorkflowHttp(this.transport, name, tags, payload);
  }

  async dryRun(name: string, payload?: Record<string, unknown>): Promise<{ pass: boolean; notFound?: boolean; [key: string]: unknown } | null> {
    const resp = await safeFetchRaw(this.transport, "POST", "/api/workflow/dry-run", {
      name,
      ...(payload && { payload }),
    });
    if (!resp) return null;
    if (resp.status === 404) return { pass: false, notFound: true };
    if (!resp.ok && resp.status !== 422) return null;
    return (await resp.json()) as { pass: boolean; [key: string]: unknown };
  }

  abortRun(runId: string): Promise<{ ok: boolean; notFound?: boolean; queued?: boolean } | null> {
    return abortRunHttp(this.transport, runId);
  }

  cancelRun(runId: string): Promise<{ ok: boolean; notFound?: boolean; active?: boolean } | null> {
    return cancelRunHttp(this.transport, runId);
  }

  listApprovals(status?: ApprovalStatus | "all"): Promise<{ approvals: PendingApproval[] } | null> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.transport.request("GET", `/approvals${query}`);
  }

  approveApproval(id: string, note?: string): Promise<{ approval: PendingApproval } | null> {
    return this.transport.request("POST", `/approvals/${encodeURIComponent(id)}/approve`, { note });
  }

  rejectApproval(id: string, reason?: string): Promise<{ approval: PendingApproval } | null> {
    return this.transport.request("POST", `/approvals/${encodeURIComponent(id)}/reject`, { reason });
  }

  approveAllApprovals(note?: string): Promise<{ approvals: PendingApproval[]; count: number } | null> {
    return this.transport.request("POST", "/approvals/approve-all", { note });
  }

  rejectAllApprovals(reason?: string): Promise<{ approvals: PendingApproval[]; count: number } | null> {
    return this.transport.request("POST", "/approvals/reject-all", { reason });
  }

  listWorkflowRuns(workflow?: string, limit?: number, tag?: string, causedByRunId?: string): Promise<{ runs: WorkflowRunSummary[] } | null> {
    return listWorkflowRunsHttp(this.transport, workflow, limit, tag, causedByRunId);
  }

  getWorkflowRun(id: string): Promise<WorkflowRunDetail | null> {
    return getWorkflowRunHttp(this.transport, id);
  }

  async registerSession(id: string, createdAt: string, autonomyMode: AutonomyMode): Promise<boolean> {
    const resp = await safeFetchRaw(this.transport, "POST", "/sessions/register", { id, createdAt, autonomyMode });
    return resp?.ok ?? false;
  }

  async unregisterSession(id: string): Promise<boolean> {
    const resp = await safeFetchRaw(this.transport, "DELETE", `/sessions/${encodeURIComponent(id)}`);
    return (resp?.ok ?? false) || resp?.status === 204;
  }

  async queryEvents(opts?: {
    type?: string;
    since?: string;
    limit?: number;
  }): Promise<{ events: Array<{ type: string; payload: Record<string, unknown>; timestamp: string }> } | null> {
    const params = new URLSearchParams();
    if (opts?.type) params.set("type", opts.type);
    if (opts?.since) params.set("since", opts.since);
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.transport.request("GET", `/api/events${qs ? `?${qs}` : ""}`);
  }

  events(): AsyncGenerator<DaemonSseEvent> {
    return this.transport.events();
  }
}
