import { join } from "node:path";
import { resolveProjectDir } from "#core/config/project-dir.js";
import type { ApprovalStatus, PendingApproval } from "#core/daemon/approval-queue.js";
import type {
  DaemonControlAddress,
  DaemonLiveStatus,
  DaemonSseEvent,
  DaemonSseEventType,
  HealthStatus,
  InteractiveSession,
  WorkflowDefinitionSummary,
  WorkflowLiveStatus,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "#core/daemon/daemon-control.js";
import type {
  OwnerQuestionStatus,
  PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
import type {
  ConversationData,
  KnowledgeEntry,
} from "#core/modules/provider-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type {
  AgentInspectResult,
  AgentsClient,
  AgentsListResult,
  ApprovalsClient,
  AuditClient,
  AuditListFilter,
  AuditListResult,
  ConfigClient,
  ConfigGetResult,
  ConfigSetResult,
  ConfigValidateResult,
  DaemonOpsClient,
  DoctorClient,
  DoctorFixResult,
  DoctorRunOptions,
  DoctorRunResult,
  EvalCalibrationOptions,
  EvalCalibrationResult,
  EvalHarnessClient,
  EvalListResult,
  EvalRunOptions,
  EvalRunResult,
  HarnessParityClient,
  HarnessParityListResult,
  HarnessParityRunOptions,
  HarnessParityRunResult,
  HistoryClient,
  HistoryDeleteResult,
  HistoryListFilter,
  HistoryListResult,
  HistoryReindexResult,
  HistorySearchFilter,
  HistorySearchResult,
  HistoryShowResult,
  KnowledgeAddOptions,
  KnowledgeAddResult,
  KnowledgeClient,
  KnowledgeDeleteResult,
  KnowledgeListFilter,
  KnowledgeListResult,
  KnowledgeReindexResult,
  KnowledgeSearchFilter,
  KnowledgeSearchResult,
  KnowledgeShowResult,
  KotaClient,
  McpServerClient,
  McpServerStartResult,
  MemoryAddResult,
  MemoryClient,
  MemoryDeleteResult,
  MemoryListEntry,
  MemoryReindexResult,
  MemorySearchFilter,
  MemorySearchResult,
  ModuleInspectResult,
  ModuleListEntry,
  ModuleReloadResult,
  ModulesAdminClient,
  ModulesClient,
  OwnerQuestionMutateResult,
  OwnerQuestionsClient,
  RecallClient,
  RecallFilter,
  RecallResult,
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
  RepoTasksClient,
  SecretGetResult,
  SecretMutateResult,
  SecretScope,
  SecretsClient,
  SessionsClient,
  SessionsSetAutonomyModeResult,
  SkillImportOptions,
  SkillImportResult,
  SkillsClient,
  SkillsListResult,
  VoiceClient,
  VoiceSynthesizeOptions,
  VoiceSynthesizeResult,
  VoiceTranscribeOptions,
  VoiceTranscribeResult,
  WebClient,
  WebhookClient,
  WebhookListResult,
  WebhookSecretGenerateResult,
  WebhookSecretRemoveResult,
  WebStartResult,
  WorkflowClient,
  WorkflowTriggerOptions,
} from "./kota-client.js";

const REPO_TASK_OPEN_STATES: RepoTaskState[] = [
  "backlog",
  "ready",
  "doing",
  "blocked",
];

const FETCH_TIMEOUT_MS = 2_000;

export type VoiceTranscribeResponse =
  | { ok: true; text: string; language?: string }
  | { ok: false; status: number; error: string; code?: string };

export type VoiceSynthesizeResponse =
  | { ok: true; audio: Buffer; mimeType: string; format: string }
  | { ok: false; status: number; error: string; code?: string };

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

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

export class DaemonControlClient implements KotaClient {
  readonly workflow: WorkflowClient;
  readonly approvals: ApprovalsClient;
  readonly secrets: SecretsClient;
  readonly tasks: RepoTasksClient;
  readonly memory: MemoryClient;
  readonly ownerQuestions: OwnerQuestionsClient;
  readonly history: HistoryClient;
  readonly knowledge: KnowledgeClient;
  readonly sessions: SessionsClient;
  readonly modules: ModulesClient;
  readonly agents: AgentsClient;
  readonly skills: SkillsClient;
  readonly harnessParity: HarnessParityClient;
  readonly webhook: WebhookClient;
  readonly voice: VoiceClient;
  readonly web: WebClient;
  readonly mcpServer: McpServerClient;
  readonly audit: AuditClient;
  readonly config: ConfigClient;
  readonly modulesAdmin: ModulesAdminClient;
  readonly daemonOps: DaemonOpsClient;
  readonly doctor: DoctorClient;
  readonly evalHarness: EvalHarnessClient;
  readonly recall: RecallClient;

  private constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {
    this.workflow = {
      listRuns: async (filter) => {
        const result = await this.listWorkflowRuns(
          filter?.workflow,
          filter?.limit,
          filter?.tag,
          filter?.causedByRunId,
        );
        return { runs: result?.runs ?? [] };
      },
      status: async () => {
        const result = await this.getWorkflowStatus();
        if (!result) throw new Error("Daemon unreachable while reading workflow status");
        return { ...result, pendingAbort: false };
      },
      pause: async () => {
        const result = await this.pause();
        if (!result) throw new Error("Daemon unreachable while pausing dispatch");
        return { paused: result.paused, already: result.already ?? false };
      },
      resume: async () => {
        const result = await this.resume();
        if (!result) throw new Error("Daemon unreachable while resuming dispatch");
        return { paused: result.paused, already: result.already ?? false };
      },
      abort: async () => {
        const result = await this.abort();
        if (!result) throw new Error("Daemon unreachable while aborting active runs");
        return { status: "applied", count: result.aborted };
      },
      reload: async () => {
        const result = await this.reload();
        if (!result) throw new Error("Daemon unreachable while reloading definitions");
        return { status: "applied", count: result.count };
      },
      enable: async (name) => {
        const result = await this.enableWorkflow(name);
        if (!result) throw new Error(`Daemon unreachable while enabling workflow "${name}"`);
        return result.notFound ? { ok: false, reason: "not_found" } : { ok: true };
      },
      disable: async (name) => {
        const result = await this.disableWorkflow(name);
        if (!result) throw new Error(`Daemon unreachable while disabling workflow "${name}"`);
        return result.notFound ? { ok: false, reason: "not_found" } : { ok: true };
      },
      cancelRun: async (id) => {
        const result = await this.cancelRun(id);
        if (!result) throw new Error(`Daemon unreachable while cancelling run "${id}"`);
        if (result.notFound) return { ok: false, reason: "not_found" };
        if (result.active) return { ok: false, reason: "active" };
        return { ok: true };
      },
      abortRun: async (id) => {
        const result = await this.abortRun(id);
        if (!result) throw new Error(`Daemon unreachable while aborting run "${id}"`);
        if (result.notFound) return { ok: false, reason: "not_found" };
        if (result.queued) return { ok: false, reason: "queued" };
        return { ok: true };
      },
      getRun: async (id) => {
        const run = await this.getWorkflowRun(id);
        return run ? { found: true, run } : { found: false };
      },
      listDefinitions: async () => {
        const result = await this.getWorkflowDefinitions();
        if (!result) {
          throw new Error("Daemon unreachable while listing workflow definitions");
        }
        return { source: "daemon", definitions: result.definitions };
      },
      triggerByName: async (name, options) => {
        const result = await this.trigger(
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
    };
    this.approvals = {
      list: async (filter) => {
        const result = await this.listApprovals(filter?.status);
        return { approvals: result?.approvals ?? [] };
      },
      approve: async (id, note) => {
        const result = await this.approveApproval(id, note);
        return result ? { ok: true, approval: result.approval } : { ok: false, reason: "not_found" };
      },
      reject: async (id, reason) => {
        const result = await this.rejectApproval(id, reason);
        return result ? { ok: true, approval: result.approval } : { ok: false, reason: "not_found" };
      },
    };
    this.secrets = {
      list: async () => {
        const result = await this.listSecretsHttp();
        return { secrets: result?.secrets ?? [] };
      },
      get: async (name) => this.getSecretHttp(name),
      set: async (name, value, scope) => this.setSecretHttp(name, value, scope),
      remove: async (name, scope) => this.removeSecretHttp(name, scope),
    };
    this.tasks = {
      list: async (states) => {
        const result = await this.listTasksHttp();
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
      show: async (id) => this.showTaskHttp(id),
      move: async (id, toState) => this.moveTaskHttp(id, toState),
      create: async (options) => this.createTaskHttp(options),
      capture: async (title) => this.captureTaskHttp(title),
      gc: async (options) => this.gcTasksHttp(options ?? {}),
      search: async (query, filter) => this.searchTasksHttp(query, filter),
      reindex: async () => this.reindexTasksHttp(),
    };
    this.memory = {
      list: async (limit) => {
        const result = await this.listMemoryHttp();
        const slice = result ? result.entries.slice(0, limit ?? Number.POSITIVE_INFINITY) : [];
        return {
          entries: slice.map((entry) => ({
            id: entry.id,
            created: entry.created,
            content: entry.excerpt,
          })),
        };
      },
      add: async (content, tags) => this.addMemoryHttp(content, tags ?? []),
      delete: async (id) => this.deleteMemoryHttp(id),
      search: async (query, filter) => this.searchMemoryHttp(query, filter),
      reindex: async () => this.reindexMemoryHttp(),
    };
    this.ownerQuestions = {
      list: async (filter) => {
        const result = await this.listOwnerQuestions(filter?.status);
        return { questions: result?.questions ?? [] };
      },
      answer: async (id, answer) => this.answerOwnerQuestionHttp(id, answer),
      dismiss: async (id, reason) => this.dismissOwnerQuestionHttp(id, reason),
    };
    this.history = {
      list: async (filter) => this.historyListHttp(filter),
      show: async (id) => this.historyShowHttp(id),
      delete: async (id) => this.historyDeleteHttp(id),
      search: async (query, filter) => this.searchHistoryHttp(query, filter),
      reindex: async () => this.reindexHistoryHttp(),
    };
    this.knowledge = {
      list: async (filter) => this.listKnowledgeHttp(filter),
      show: async (id) => this.showKnowledgeHttp(id),
      search: async (query, filter) => this.searchKnowledgeHttp(query, filter),
      add: async (options) => this.addKnowledgeHttp(options),
      delete: async (id) => this.deleteKnowledgeHttp(id),
      reindex: async () => this.reindexKnowledgeHttp(),
    };
    this.sessions = {
      list: async () => {
        const result = await this.listSessionsHttp();
        if (!result) throw new Error("Daemon unreachable while listing sessions");
        return { sessions: result.sessions };
      },
      setAutonomyMode: async (id, mode) => this.setSessionAutonomyModeHttp(id, mode),
    };
    this.modules = {
      list: async () => {
        const result = await this.listModulesHttp();
        if (!result) throw new Error("Daemon unreachable while listing modules");
        return { modules: result.modules };
      },
    };
    this.agents = {
      list: async () => this.listAgentsHttp(),
      inspect: async (name) => this.inspectAgentHttp(name),
    };
    this.skills = {
      list: async () => this.listSkillsHttp(),
      import: async (source, options) => this.importSkillHttp(source, options),
    };
    this.harnessParity = {
      list: async () => this.listHarnessParityScenariosHttp(),
      run: async (options) => this.runHarnessParityHttp(options),
    };
    this.webhook = {
      list: async () => this.listWebhooksHttp(),
      secretGenerate: async (workflow) => this.generateWebhookSecretHttp(workflow),
      secretRemove: async (workflow) => this.removeWebhookSecretHttp(workflow),
    };
    this.voice = {
      transcribe: async (options) => this.voiceTranscribeNamespace(options),
      synthesize: async (options) => this.voiceSynthesizeNamespace(options),
    };
    /**
     * `kota serve` and `kota mcp-server` start a long-running process in the
     * caller's address space. The daemon cannot start either on the caller's
     * behalf, so the namespace surfaces `daemon_required` uniformly when the
     * selector picked the daemon transport. The CLI maps that to a clear
     * "stop the daemon first" hint instead of inventing a second exception
     * path through the namespace contract.
     */
    this.web = {
      start: async (_options): Promise<WebStartResult> => ({ ok: false, reason: "daemon_required" }),
    };
    this.mcpServer = {
      start: async (_options): Promise<McpServerStartResult> => ({ ok: false, reason: "daemon_required" }),
    };
    this.audit = {
      list: async (filter) => this.listAuditHttp(filter),
    };
    this.config = {
      validate: async () => this.configValidateHttp(),
      get: async (key) => this.configGetHttp(key),
      set: async (key, rawValue) => this.configSetHttp(key, rawValue),
      schemaPath: async () => this.configSchemaPathHttp(),
      schemaContent: async () => this.configSchemaContentHttp(),
    };
    this.modulesAdmin = {
      inspect: async (name) => this.modulesInspectHttp(name),
      reload: async (name) => this.modulesReloadHttp(name),
    };
    /**
     * The daemon-up daemonOps namespace always reports `running` because the
     * client only exists when the selector resolved to a daemon address. The
     * local handler is the one that distinguishes "not running" from "stale
     * control file" — the daemon-up branch never sees those states.
     */
    this.daemonOps = {
      status: async () => {
        const status = await this.getDaemonStatus();
        if (!status) {
          throw new Error("Daemon unreachable while reading daemon status");
        }
        const managed = await this.daemonManagedHttp();
        return { state: "running", managed, status };
      },
      pid: async () => {
        const status = await this.getDaemonStatus();
        if (!status || typeof status.pid !== "number") {
          throw new Error("Daemon unreachable while reading daemon pid");
        }
        return { state: "running", pid: status.pid };
      },
      stop: async (_options) => {
        throw new Error(
          "daemonOps.stop is owned by the local handler — the daemon cannot SIGTERM itself.",
        );
      },
      reload: async () => {
        const result = await this.reloadConfig();
        if (!result) return { ok: false, reason: "reload_failed" };
        return { ok: true, workflows: result.workflows, changedModules: result.changedModules };
      },
    };
    this.doctor = {
      run: async (options) => this.doctorRunHttp(options),
      fix: async () => this.doctorFixHttp(),
    };
    this.evalHarness = {
      list: async () => this.evalListHttp(),
      run: async (options) => this.evalRunHttp(options),
      calibration: async (options) => this.evalCalibrationHttp(options),
    };
    this.recall = {
      recall: async (query, filter) => this.recallHttp(query, filter),
    };
  }

  private async recallHttp(query: string, filter?: RecallFilter): Promise<RecallResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/recall`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify({ query, ...(filter && { filter }) }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as RecallResult;
  }

  private async listAuditHttp(filter?: AuditListFilter): Promise<AuditListResult> {
    const params = new URLSearchParams();
    if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
    if (filter?.tool) params.set("tool", filter.tool);
    if (filter?.risk) params.set("risk", filter.risk);
    if (filter?.policy) params.set("policy", filter.policy);
    if (filter?.since) params.set("since", filter.since);
    if (filter?.session) params.set("session", filter.session);
    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetchWithTimeout(`${this.baseUrl}/audit${query}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as AuditListResult;
  }

  private async configValidateHttp(): Promise<ConfigValidateResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/config/validate`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as ConfigValidateResult;
  }

  private async configGetHttp(key: string): Promise<ConfigGetResult> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/config/value?key=${encodeURIComponent(key)}`,
      { headers: this.authHeaders() },
    );
    if (res.status === 404) return { found: false, reason: "not_found" };
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as ConfigGetResult;
  }

  private async configSetHttp(key: string, rawValue: string): Promise<ConfigSetResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/config/value`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify({ key, rawValue }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as ConfigSetResult;
  }

  private async configSchemaPathHttp(): Promise<{ path: string }> {
    const res = await fetchWithTimeout(`${this.baseUrl}/config/schema-path`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as { path: string };
  }

  private async configSchemaContentHttp(): Promise<{ content: string }> {
    const res = await fetchWithTimeout(`${this.baseUrl}/config/schema`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as { content: string };
  }

  private async modulesInspectHttp(name: string): Promise<ModuleInspectResult> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/modules/${encodeURIComponent(name)}`,
      { headers: this.authHeaders() },
    );
    if (res.status === 404) return { found: false };
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as ModuleInspectResult;
  }

  private async modulesReloadHttp(name: string): Promise<ModuleReloadResult> {
    const result = await this.reloadConfig();
    if (!result) return { ok: false, reason: "daemon_required" };
    const modulesRes = await this.listModulesHttp();
    if (modulesRes && !modulesRes.modules.some((m) => m.name === name)) {
      return { ok: false, reason: "not_found" };
    }
    return {
      ok: true,
      reloaded: result.changedModules.includes(name),
      workflowsActive: result.workflows,
    };
  }

  /**
   * The OS-managed daemon flag is filesystem-scoped (it checks for a
   * launchd plist or systemd unit on the operator host). The daemon
   * cannot answer that for the calling host, so the daemon-up branch
   * always reports `false`; the local handler is the one that probes
   * the operator filesystem.
   */
  private async daemonManagedHttp(): Promise<boolean> {
    return false;
  }

  private async doctorRunHttp(options?: DoctorRunOptions): Promise<DoctorRunResult> {
    const params = new URLSearchParams();
    if (options?.skipConnectivity) params.set("skipConnectivity", "true");
    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetchWithTimeout(`${this.baseUrl}/doctor/run${query}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as DoctorRunResult;
  }

  private async doctorFixHttp(): Promise<DoctorFixResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/doctor/fix`, {
      method: "POST",
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as DoctorFixResult;
  }

  private async evalListHttp(): Promise<EvalListResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/eval/list`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as EvalListResult;
  }

  private async evalRunHttp(options?: EvalRunOptions): Promise<EvalRunResult> {
    const res = await fetch(`${this.baseUrl}/api/eval/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify(options ?? {}),
    });
    if (res.status === 400) {
      const body = (await res.json()) as { error: string };
      const msg = body.error;
      if (/no fixtures/i.test(msg)) return { ok: false, reason: "no_fixtures", message: msg };
      return { ok: false, reason: "fixture_provenance", message: msg };
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      fixtureCount: number;
      repeatCount: number;
      passAtK: number;
      passHatK: number;
      runArtifactBaseDir: string;
    };
    return { ok: true, ...body };
  }

  private async evalCalibrationHttp(
    options?: EvalCalibrationOptions,
  ): Promise<EvalCalibrationResult> {
    const params = new URLSearchParams();
    if (options?.windowDays !== undefined) params.set("windowDays", String(options.windowDays));
    if (options?.followUpDays !== undefined) params.set("followUpDays", String(options.followUpDays));
    if (options?.thresholdRate !== undefined) params.set("thresholdRate", String(options.thresholdRate));
    if (options?.minSample !== undefined) params.set("minSample", String(options.minSample));
    if (options?.runsDir) params.set("runsDir", options.runsDir);
    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetchWithTimeout(`${this.baseUrl}/eval/calibration${query}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as EvalCalibrationResult;
  }

  private async listWebhooksHttp(): Promise<WebhookListResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/webhooks`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as WebhookListResult;
  }

  private async generateWebhookSecretHttp(
    workflow: string,
  ): Promise<WebhookSecretGenerateResult> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/webhooks/${encodeURIComponent(workflow)}/secret`,
      { method: "POST", headers: this.authHeaders() },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as WebhookSecretGenerateResult;
  }

  private async removeWebhookSecretHttp(
    workflow: string,
  ): Promise<WebhookSecretRemoveResult> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/webhooks/${encodeURIComponent(workflow)}/secret`,
      { method: "DELETE", headers: this.authHeaders() },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as WebhookSecretRemoveResult;
  }

  private async voiceTranscribeNamespace(
    options: VoiceTranscribeOptions,
  ): Promise<VoiceTranscribeResult> {
    const result = await this.voiceTranscribe(options);
    if (result.ok) {
      return {
        ok: true,
        text: result.text,
        ...(result.language !== undefined && { language: result.language }),
      };
    }
    return {
      ok: false,
      reason: "transport_error",
      status: result.status,
      message: result.error,
      ...(result.code !== undefined && { code: result.code }),
    };
  }

  private async voiceSynthesizeNamespace(
    options: VoiceSynthesizeOptions,
  ): Promise<VoiceSynthesizeResult> {
    const result = await this.voiceSynthesize(options);
    if (result.ok) {
      return {
        ok: true,
        audio: result.audio,
        mimeType: result.mimeType,
        format: result.format,
      };
    }
    return {
      ok: false,
      reason: "transport_error",
      status: result.status,
      message: result.error,
      ...(result.code !== undefined && { code: result.code }),
    };
  }

  private async listAgentsHttp(): Promise<AgentsListResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/agents`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as AgentsListResult;
  }

  private async inspectAgentHttp(name: string): Promise<AgentInspectResult> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/agents/${encodeURIComponent(name)}`,
      { headers: this.authHeaders() },
    );
    if (res.status === 404) return { found: false };
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as AgentInspectResult;
  }

  private async listSkillsHttp(): Promise<SkillsListResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/skills`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as SkillsListResult;
  }

  private async importSkillHttp(
    source: string,
    options?: SkillImportOptions,
  ): Promise<SkillImportResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/skills/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify({
        source,
        ...(options?.name !== undefined && { name: options.name }),
      }),
    });
    if (res.status === 400 || res.status === 502) {
      const body = (await res.json()) as SkillImportResult;
      return body;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as SkillImportResult;
  }

  private async listHarnessParityScenariosHttp(): Promise<HarnessParityListResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/harness-parity/scenarios`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as HarnessParityListResult;
  }

  private async runHarnessParityHttp(
    options?: HarnessParityRunOptions,
  ): Promise<HarnessParityRunResult> {
    const res = await fetch(`${this.baseUrl}/harness-parity/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify(options ?? {}),
    });
    if (res.status === 400) {
      return (await res.json()) as HarnessParityRunResult;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as HarnessParityRunResult;
  }

  private async listSessionsHttp(): Promise<{ sessions: InteractiveSession[] } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/sessions`, {
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as { sessions: InteractiveSession[] };
    } catch {
      return null;
    }
  }

  private async setSessionAutonomyModeHttp(
    id: string,
    mode: AutonomyMode,
  ): Promise<SessionsSetAutonomyModeResult> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({ autonomy_mode: mode }),
      });
      if (res.status === 404) return { ok: false, reason: "not_found" };
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        autonomy_mode: AutonomyMode;
        source?: "daemon" | "serve";
        serveOwned?: boolean;
      };
      return {
        ok: true,
        autonomyMode: body.autonomy_mode,
        source: body.source ?? "daemon",
        serveOwned: body.serveOwned === true,
      };
    } catch (err) {
      if (err instanceof Error && /HTTP/.test(err.message)) throw err;
      return { ok: false, reason: "daemon_required" };
    }
  }

  private async listModulesHttp(): Promise<{ modules: ModuleListEntry[] } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/modules`, {
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as { modules: ModuleListEntry[] };
    } catch {
      return null;
    }
  }

  private async listKnowledgeHttp(
    filter?: KnowledgeListFilter,
  ): Promise<KnowledgeListResult> {
    const params = new URLSearchParams();
    if (filter?.tag) params.set("tag", filter.tag);
    if (filter?.type) params.set("type", filter.type);
    if (filter?.status) params.set("status", filter.status);
    if (filter?.scope) params.set("scope", filter.scope);
    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetchWithTimeout(`${this.baseUrl}/api/knowledge${query}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const body = (await res.json()) as { entries: KnowledgeEntry[] };
    return { entries: body.entries };
  }

  private async showKnowledgeHttp(id: string): Promise<KnowledgeShowResult> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/knowledge/${encodeURIComponent(id)}`,
      { headers: this.authHeaders() },
    );
    if (res.status === 404) return { found: false };
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const entry = (await res.json()) as KnowledgeEntry;
    return { found: true, entry };
  }

  private async searchKnowledgeHttp(
    query: string,
    filter?: KnowledgeSearchFilter,
  ): Promise<KnowledgeSearchResult> {
    const params = new URLSearchParams();
    params.set("q", query);
    if (filter?.tag) params.set("tag", filter.tag);
    if (filter?.type) params.set("type", filter.type);
    if (filter?.status) params.set("status", filter.status);
    if (filter?.scope) params.set("scope", filter.scope);
    if (filter?.semantic) params.set("semantic", "true");
    if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/knowledge/search?${params.toString()}`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as KnowledgeSearchResult;
  }

  private async addKnowledgeHttp(
    options: KnowledgeAddOptions,
  ): Promise<KnowledgeAddResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/api/knowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify(options),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const body = (await res.json()) as { id: string };
    return { id: body.id };
  }

  private async deleteKnowledgeHttp(id: string): Promise<KnowledgeDeleteResult> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/knowledge/${encodeURIComponent(id)}`,
      { method: "DELETE", headers: this.authHeaders() },
    );
    if (res.status === 404) return { ok: false, reason: "not_found" };
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return { ok: true };
  }

  private async reindexKnowledgeHttp(): Promise<KnowledgeReindexResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/api/knowledge/reindex`, {
      method: "POST",
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as KnowledgeReindexResult;
  }

  private async historyListHttp(filter?: HistoryListFilter): Promise<HistoryListResult> {
    const params = new URLSearchParams();
    if (filter?.search) params.set("search", filter.search);
    if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
    if (filter?.cwd) params.set("cwd", filter.cwd);
    if (filter?.source) params.set("source", filter.source);
    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetchWithTimeout(`${this.baseUrl}/history${query}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as HistoryListResult;
  }

  private async historyShowHttp(id: string): Promise<HistoryShowResult> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/history/${encodeURIComponent(id)}`,
      { headers: this.authHeaders() },
    );
    if (res.status === 404) return { found: false };
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as ConversationData;
    return { found: true, data };
  }

  private async historyDeleteHttp(id: string): Promise<HistoryDeleteResult> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/history/${encodeURIComponent(id)}`,
      { method: "DELETE", headers: this.authHeaders() },
    );
    if (res.status === 204) return { ok: true };
    if (res.status === 404) return { ok: false, reason: "not_found" };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  private async reindexHistoryHttp(): Promise<HistoryReindexResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/history/reindex`, {
      method: "POST",
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as HistoryReindexResult;
  }

  private async searchHistoryHttp(
    query: string,
    filter?: HistorySearchFilter,
  ): Promise<HistorySearchResult> {
    const params = new URLSearchParams();
    params.set("q", query);
    if (filter?.cwd) params.set("cwd", filter.cwd);
    if (filter?.source) params.set("source", filter.source);
    if (filter?.semantic) params.set("semantic", "true");
    if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/history/search?${params.toString()}`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as HistorySearchResult;
  }

  private async answerOwnerQuestionHttp(
    id: string,
    answer: string,
  ): Promise<OwnerQuestionMutateResult> {
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/owner-questions/${encodeURIComponent(id)}/answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.authHeaders() },
          body: JSON.stringify({ answer }),
        },
      );
      if (res.status === 404) return { ok: false, reason: "not_found" };
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { question: PendingOwnerQuestion };
      return { ok: true, question: body.question };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("HTTP ")) throw err;
      return { ok: false, reason: "not_found" };
    }
  }

  private async dismissOwnerQuestionHttp(
    id: string,
    reason?: string,
  ): Promise<OwnerQuestionMutateResult> {
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/owner-questions/${encodeURIComponent(id)}/dismiss`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.authHeaders() },
          body: JSON.stringify(reason !== undefined ? { reason } : {}),
        },
      );
      if (res.status === 404) return { ok: false, reason: "not_found" };
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { question: PendingOwnerQuestion };
      return { ok: true, question: body.question };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("HTTP ")) throw err;
      return { ok: false, reason: "not_found" };
    }
  }

  async listOwnerQuestions(
    status?: OwnerQuestionStatus | "all",
  ): Promise<{ questions: PendingOwnerQuestion[] } | null> {
    try {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      const res = await fetchWithTimeout(`${this.baseUrl}/owner-questions${query}`, {
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as { questions: PendingOwnerQuestion[] };
    } catch {
      return null;
    }
  }

  private async addMemoryHttp(content: string, tags: string[]): Promise<MemoryAddResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/api/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify({ content, tags }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const body = (await res.json()) as { id: string };
    return { id: body.id };
  }

  private async deleteMemoryHttp(id: string): Promise<MemoryDeleteResult> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/memory/${encodeURIComponent(id)}`,
      { method: "DELETE", headers: this.authHeaders() },
    );
    if (res.status === 404) return { ok: false, reason: "not_found" };
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return { ok: true };
  }

  private async searchMemoryHttp(
    query: string,
    filter?: MemorySearchFilter,
  ): Promise<MemorySearchResult> {
    const params = new URLSearchParams();
    params.set("q", query);
    if (filter?.tag) params.set("tag", filter.tag);
    if (filter?.since) params.set("since", filter.since);
    if (filter?.semantic) params.set("semantic", "true");
    if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/memory/search?${params.toString()}`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const body = (await res.json()) as
      | { ok: true; entries: MemoryListEntry[] }
      | { ok: false; reason: "semantic_unavailable" };
    return body;
  }

  private async reindexMemoryHttp(): Promise<MemoryReindexResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/api/memory/reindex`, {
      method: "POST",
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as MemoryReindexResult;
  }

  private async listSecretsHttp(): Promise<{ secrets: { name: string; source: string }[] } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/secrets`, {
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as { secrets: { name: string; source: string }[] };
    } catch {
      return null;
    }
  }

  private async getSecretHttp(name: string): Promise<SecretGetResult> {
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/api/secrets/${encodeURIComponent(name)}`,
        { headers: this.authHeaders() },
      );
      if (res.status === 404) return { found: false };
      if (!res.ok) return { found: false };
      const body = (await res.json()) as { found: boolean; value?: string };
      if (body.found && typeof body.value === "string") {
        return { found: true, value: body.value };
      }
      return { found: false };
    } catch {
      return { found: false };
    }
  }

  private async setSecretHttp(
    name: string,
    value: string,
    scope: SecretScope,
  ): Promise<SecretMutateResult> {
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/api/secrets/${encodeURIComponent(name)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...this.authHeaders() },
          body: JSON.stringify({ value, scope }),
        },
      );
      if (res.ok) return { ok: true };
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, reason: "store_error", message: body.error ?? `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, reason: "store_error", message: (err as Error).message };
    }
  }

  private async removeSecretHttp(
    name: string,
    scope: SecretScope,
  ): Promise<SecretMutateResult> {
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/api/secrets/${encodeURIComponent(name)}?scope=${encodeURIComponent(scope)}`,
        { method: "DELETE", headers: this.authHeaders() },
      );
      if (res.status === 404) return { ok: false, reason: "not_found" };
      if (res.ok) return { ok: true };
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, reason: "store_error", message: body.error ?? `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, reason: "store_error", message: (err as Error).message };
    }
  }

  private async showTaskHttp(id: string): Promise<RepoTaskShowResult> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/tasks/${encodeURIComponent(id)}`,
      { headers: this.authHeaders() },
    );
    if (res.status === 404) return { found: false };
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const body = (await res.json()) as { state: RepoTaskState; content: string };
    return { found: true, state: body.state, content: body.content };
  }

  private async moveTaskHttp(
    id: string,
    toState: RepoTaskState,
  ): Promise<RepoTaskMoveResult> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/tasks/${encodeURIComponent(id)}/move`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
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

  private async createTaskHttp(
    options: RepoTaskCreateOptions,
  ): Promise<RepoTaskCreateResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/api/tasks/normalized`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
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

  private async captureTaskHttp(title: string): Promise<RepoTaskCaptureResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/api/tasks/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
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

  private async gcTasksHttp(options: RepoTaskGcOptions): Promise<RepoTaskGcResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/api/tasks/gc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify(options),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as RepoTaskGcResult;
  }

  private async searchTasksHttp(
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
      `${this.baseUrl}/tasks/search?${params.toString()}`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as RepoTaskSearchResult;
  }

  private async reindexTasksHttp(): Promise<RepoTaskReindexResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/tasks/reindex`, {
      method: "POST",
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as RepoTaskReindexResult;
  }

  private async listTasksHttp(): Promise<
    | {
        counts: Record<string, number>;
        tasks: Record<string, { id: string; title: string; priority: string; area: string; summary: string; body: string }[]>;
      }
    | null
  > {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/tasks`, {
        headers: this.authHeaders(),
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

  private async listMemoryHttp(): Promise<{ entries: { id: string; tags: string[]; created: string; excerpt: string }[] } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/memory`, {
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as { entries: { id: string; tags: string[]; created: string; excerpt: string }[] };
    } catch {
      return null;
    }
  }

  static fromStateDir(stateDir?: string): DaemonControlClient | null {
    const dir = stateDir ?? join(resolveProjectDir(), ".kota");
    const address = readOptionalJsonFile<DaemonControlAddress>(join(dir, "daemon-control.json"));
    if (!address || typeof address.port !== "number") return null;
    return DaemonControlClient.fromAddress(address);
  }

  static fromAddress(address: DaemonControlAddress): DaemonControlClient {
    return new DaemonControlClient(
      `http://127.0.0.1:${address.port}`,
      typeof address.token === "string" ? address.token : undefined,
    );
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async getHealth(): Promise<{ status: string; components: HealthStatus } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/health`);
      if (!res.ok) return null;
      return (await res.json()) as { status: string; components: HealthStatus };
    } catch {
      return null;
    }
  }

  async getDaemonStatus(): Promise<DaemonLiveStatus | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/status`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as DaemonLiveStatus;
    } catch {
      return null;
    }
  }

  async getWorkflowStatus(): Promise<WorkflowLiveStatus | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/status`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as WorkflowLiveStatus;
    } catch {
      return null;
    }
  }

  async getWorkflowDefinitions(): Promise<{ definitions: WorkflowDefinitionSummary[] } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/definitions`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as { definitions: WorkflowDefinitionSummary[] };
    } catch {
      return null;
    }
  }

  async pause(): Promise<{ ok: boolean; paused: boolean; already?: boolean } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/pause`, {
        method: "POST",
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; paused: boolean; already?: boolean };
    } catch {
      return null;
    }
  }

  async resume(): Promise<{ ok: boolean; paused: boolean; already?: boolean } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/resume`, {
        method: "POST",
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; paused: boolean; already?: boolean };
    } catch {
      return null;
    }
  }

  async abort(): Promise<{ ok: boolean; aborted: number } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/abort`, {
        method: "POST",
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; aborted: number };
    } catch {
      return null;
    }
  }

  async reload(): Promise<{ ok: boolean; count: number } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/reload`, {
        method: "POST",
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; count: number };
    } catch {
      return null;
    }
  }

  async reloadConfig(): Promise<{ ok: boolean; workflows: number; changedModules: string[] } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/reload`, {
        method: "POST",
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; workflows: number; changedModules: string[] };
    } catch {
      return null;
    }
  }

  async enableWorkflow(name: string): Promise<{ ok: boolean; notFound?: boolean } | null> {
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/workflow/definitions/${encodeURIComponent(name)}/enable`,
        { method: "POST", headers: this.authHeaders() },
      );
      if (res.status === 404) return { ok: false, notFound: true };
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean };
    } catch {
      return null;
    }
  }

  async disableWorkflow(name: string): Promise<{ ok: boolean; notFound?: boolean } | null> {
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/workflow/definitions/${encodeURIComponent(name)}/disable`,
        { method: "POST", headers: this.authHeaders() },
      );
      if (res.status === 404) return { ok: false, notFound: true };
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean };
    } catch {
      return null;
    }
  }

  async trigger(name: string, tags?: string[], payload?: Record<string, unknown>): Promise<{ ok: boolean; queued?: string; runId?: string; alreadyQueued?: boolean } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({ name, ...(tags && tags.length > 0 && { tags }), ...(payload && { payload }) }),
      });
      if (res.status === 409) return { ok: false, alreadyQueued: true };
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; queued?: string; runId?: string };
    } catch {
      return null;
    }
  }

  async dryRun(name: string, payload?: Record<string, unknown>): Promise<{ pass: boolean; notFound?: boolean; [key: string]: unknown } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/workflow/dry-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({ name, ...(payload && { payload }) }),
      });
      if (res.status === 404) return { pass: false, notFound: true };
      if (!res.ok && res.status !== 422) return null;
      return (await res.json()) as { pass: boolean; [key: string]: unknown };
    } catch {
      return null;
    }
  }

  async abortRun(runId: string): Promise<{ ok: boolean; notFound?: boolean; queued?: boolean } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/runs/${encodeURIComponent(runId)}/abort`, {
        method: "POST",
        headers: this.authHeaders(),
      });
      if (res.status === 404) return { ok: false, notFound: true };
      if (res.status === 409) return { ok: false, queued: true };
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean };
    } catch {
      return null;
    }
  }

  async cancelRun(runId: string): Promise<{ ok: boolean; notFound?: boolean; active?: boolean } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/runs/${encodeURIComponent(runId)}`, {
        method: "DELETE",
        headers: this.authHeaders(),
      });
      if (res.status === 404) return { ok: false, notFound: true };
      if (res.status === 409) return { ok: false, active: true };
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean };
    } catch {
      return null;
    }
  }

  async listHistory(
    filter?: HistoryListFilter,
  ): Promise<HistoryListResult | null> {
    try {
      return await this.historyListHttp(filter);
    } catch {
      return null;
    }
  }

  async getHistory(id: string): Promise<ConversationData | null> {
    try {
      const result = await this.historyShowHttp(id);
      return result.found ? result.data : null;
    } catch {
      return null;
    }
  }

  async deleteHistory(id: string): Promise<boolean> {
    try {
      const result = await this.historyDeleteHttp(id);
      return result.ok;
    } catch {
      return false;
    }
  }

  async listApprovals(
    status?: ApprovalStatus | "all",
  ): Promise<{ approvals: PendingApproval[] } | null> {
    try {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      const res = await fetchWithTimeout(`${this.baseUrl}/approvals${query}`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as { approvals: PendingApproval[] };
    } catch {
      return null;
    }
  }

  async approveApproval(id: string, note?: string): Promise<{ approval: PendingApproval } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/approvals/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) return null;
      return (await res.json()) as { approval: PendingApproval };
    } catch {
      return null;
    }
  }

  async rejectApproval(id: string, reason?: string): Promise<{ approval: PendingApproval } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/approvals/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) return null;
      return (await res.json()) as { approval: PendingApproval };
    } catch {
      return null;
    }
  }

  async approveAllApprovals(note?: string): Promise<{ approvals: PendingApproval[]; count: number } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/approvals/approve-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) return null;
      return (await res.json()) as { approvals: PendingApproval[]; count: number };
    } catch {
      return null;
    }
  }

  async rejectAllApprovals(reason?: string): Promise<{ approvals: PendingApproval[]; count: number } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/approvals/reject-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) return null;
      return (await res.json()) as { approvals: PendingApproval[]; count: number };
    } catch {
      return null;
    }
  }

  async listWorkflowRuns(workflow?: string, limit?: number, tag?: string, causedByRunId?: string): Promise<{ runs: WorkflowRunSummary[] } | null> {
    try {
      const params = new URLSearchParams();
      if (workflow) params.set("workflow", workflow);
      if (limit !== undefined) params.set("limit", String(limit));
      if (tag) params.set("tag", tag);
      if (causedByRunId) params.set("causedByRunId", causedByRunId);
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/runs${query}`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as { runs: WorkflowRunSummary[] };
    } catch {
      return null;
    }
  }

  async getWorkflowRun(id: string): Promise<WorkflowRunDetail | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/runs/${encodeURIComponent(id)}`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as WorkflowRunDetail;
    } catch {
      return null;
    }
  }

  async registerSession(id: string, createdAt: string, autonomyMode: AutonomyMode): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/sessions/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({ id, createdAt, autonomyMode }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async setSessionAutonomyMode(id: string, autonomyMode: AutonomyMode): Promise<{
    ok: boolean;
    notFound?: boolean;
    autonomyMode?: AutonomyMode;
    source?: string;
    serveOwned?: boolean;
  } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({ autonomy_mode: autonomyMode }),
      });
      if (res.status === 404) return { ok: false, notFound: true };
      if (!res.ok) return null;
      const body = (await res.json()) as { autonomy_mode?: string; source?: string; serveOwned?: boolean };
      return {
        ok: true,
        autonomyMode: (body.autonomy_mode ?? autonomyMode) as AutonomyMode,
        source: body.source,
        serveOwned: body.serveOwned,
      };
    } catch {
      return null;
    }
  }

  async unregisterSession(id: string): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: this.authHeaders(),
      });
      return res.ok || res.status === 204;
    } catch {
      return false;
    }
  }

  async queryEvents(opts?: {
    type?: string;
    since?: string;
    limit?: number;
  }): Promise<{ events: Array<{ type: string; payload: Record<string, unknown>; timestamp: string }> } | null> {
    try {
      const params = new URLSearchParams();
      if (opts?.type) params.set("type", opts.type);
      if (opts?.since) params.set("since", opts.since);
      if (opts?.limit != null) params.set("limit", String(opts.limit));
      const qs = params.toString();
      const url = `${this.baseUrl}/api/events${qs ? `?${qs}` : ""}`;
      const res = await fetchWithTimeout(url, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as { events: Array<{ type: string; payload: Record<string, unknown>; timestamp: string }> };
    } catch {
      return null;
    }
  }

  async voiceTranscribe(input: {
    audio: Uint8Array;
    mimeType: string;
    filename?: string;
    languageHint?: string;
  }): Promise<VoiceTranscribeResponse> {
    const body = {
      audioBase64: Buffer.from(input.audio).toString("base64"),
      mimeType: input.mimeType,
      ...(input.filename !== undefined && { filename: input.filename }),
      ...(input.languageHint !== undefined && { languageHint: input.languageHint }),
    };
    const res = await fetch(`${this.baseUrl}/voice/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, status: res.status, error: asString(parsed.error), code: asString(parsed.code) };
    }
    return {
      ok: true,
      text: String(parsed.text ?? ""),
      ...(typeof parsed.language === "string" && { language: parsed.language }),
    };
  }

  async voiceSynthesize(input: {
    text: string;
    voice?: string;
    languageHint?: string;
    format?: string;
  }): Promise<VoiceSynthesizeResponse> {
    const res = await fetch(`${this.baseUrl}/voice/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify(input),
    });
    const parsed = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, status: res.status, error: asString(parsed.error), code: asString(parsed.code) };
    }
    return {
      ok: true,
      audio: Buffer.from(String(parsed.audioBase64 ?? ""), "base64"),
      mimeType: String(parsed.mimeType ?? ""),
      format: String(parsed.format ?? ""),
    };
  }

  async *events(): AsyncGenerator<DaemonSseEvent> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/events`, { headers: this.authHeaders() });
      if (!res.ok || !res.body) return;
    } catch {
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";

        for (const message of messages) {
          if (!message.trim()) continue;
          const lines = message.split("\n");
          let eventType = "";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            else if (line.startsWith("data: ")) data = line.slice(6).trim();
          }
          if (eventType && data) {
            try {
              yield {
                type: eventType as DaemonSseEventType,
                payload: JSON.parse(data) as Record<string, unknown>,
              };
            } catch (err) {
              console.warn("[kota-daemon-client] Failed to parse daemon SSE event:", err instanceof Error ? err.message : String(err));
            }
          }
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch (err) {
        console.warn("[kota-daemon-client] Failed to cancel daemon SSE reader:", err instanceof Error ? err.message : String(err));
      }
    }
  }
}
