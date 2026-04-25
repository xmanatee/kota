import { join } from "node:path";
import { resolveProjectDir } from "#core/config/project-dir.js";
import type { ApprovalStatus, PendingApproval } from "#core/daemon/approval-queue.js";
import type {
  DaemonControlAddress,
  DaemonLiveStatus,
  DaemonSseEvent,
  DaemonSseEventType,
  HealthStatus,
  WorkflowDefinitionSummary,
  WorkflowLiveStatus,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "#core/daemon/daemon-control.js";
import type { ConversationData, ConversationRecord } from "#core/modules/provider-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type {
  ApprovalsClient,
  KotaClient,
  MemoryClient,
  RepoTaskListEntry,
  RepoTaskState,
  RepoTasksClient,
  SecretGetResult,
  SecretMutateResult,
  SecretScope,
  SecretsClient,
  WorkflowClient,
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
    };
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

  async listHistory(search?: string, limit?: number): Promise<{ conversations: ConversationRecord[] } | null> {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (limit !== undefined) params.set("limit", String(limit));
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await fetchWithTimeout(`${this.baseUrl}/history${query}`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as { conversations: ConversationRecord[] };
    } catch {
      return null;
    }
  }

  async getHistory(id: string): Promise<ConversationData | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/history/${encodeURIComponent(id)}`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as ConversationData;
    } catch {
      return null;
    }
  }

  async deleteHistory(id: string): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/history/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: this.authHeaders(),
      });
      return res.status === 204;
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
