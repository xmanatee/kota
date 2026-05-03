import { join } from "node:path";
import { resolveProjectDir } from "#core/config/project-dir.js";
import type { ApprovalStatus, PendingApproval } from "#core/daemon/approval-queue.js";
import type { CapabilityReadinessResponse } from "#core/daemon/capability-readiness.js";
import type { ClientIdentity } from "#core/daemon/client-identity.js";
import type {
  DaemonControlAddress,
  DaemonLiveStatus,
  DaemonSseEvent,
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
import { type DaemonTransport, daemonTransportFromAddress } from "./daemon-transport.js";
import type {
  AgentInspectResult,
  AgentsListResult,
  AnswerFilter,
  AnswerHistoryListFilter,
  AnswerHistoryListResult,
  AnswerHistoryShowResult,
  AnswerResult,
  AuditListFilter,
  AuditListResult,
  CaptureFilter,
  CaptureResult,
  ConfigGetResult,
  ConfigSetResult,
  ConfigValidateResult,
  DoctorFixResult,
  DoctorRunOptions,
  DoctorRunResult,
  EvalCalibrationOptions,
  EvalCalibrationResult,
  EvalListResult,
  EvalRunOptions,
  EvalRunResult,
  HarnessParityListResult,
  HarnessParityRunOptions,
  HarnessParityRunResult,
  HistoryDeleteResult,
  HistoryListFilter,
  HistoryListResult,
  HistoryReindexResult,
  HistorySearchFilter,
  HistorySearchResult,
  HistoryShowResult,
  KnowledgeAddOptions,
  KnowledgeAddResult,
  KnowledgeDeleteResult,
  KnowledgeListFilter,
  KnowledgeListResult,
  KnowledgeReindexResult,
  KnowledgeSearchFilter,
  KnowledgeSearchResult,
  KnowledgeShowResult,
  KotaClient,
  McpServerStartResult,
  MemoryAddResult,
  MemoryDeleteResult,
  MemoryListEntry,
  MemoryReindexResult,
  MemorySearchFilter,
  MemorySearchResult,
  ModuleInspectResult,
  ModuleListEntry,
  ModuleReloadResult,
  OwnerQuestionMutateResult,
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
  RetractRequest,
  RetractResult,
  SecretGetResult,
  SecretMutateResult,
  SecretScope,
  SessionsSetAutonomyModeResult,
  SkillImportOptions,
  SkillImportResult,
  SkillsListResult,
  VoiceSynthesizeOptions,
  VoiceSynthesizeResult,
  VoiceTranscribeOptions,
  VoiceTranscribeResult,
  WebhookListResult,
  WebhookSecretGenerateResult,
  WebhookSecretRemoveResult,
  WebStartResult,
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

/**
 * Strict decoder for `GET /answers` responses. Rejects loud rather than
 * silently dropping malformed shapes — same discipline `KotaClient.answer`
 * already follows for the synthesizer envelope.
 */
function decodeAnswerHistoryListResult(value: unknown): AnswerHistoryListResult {
  if (!isObject(value)) {
    throw new Error("Malformed answer history list payload: not an object");
  }
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    throw new Error("Malformed answer history list payload: entries not an array");
  }
  for (const entry of entries) {
    if (!isObject(entry)) {
      throw new Error("Malformed answer history entry: not an object");
    }
    const obj = entry as Record<string, unknown>;
    if (typeof obj.id !== "string") {
      throw new Error("Malformed answer history entry: missing id");
    }
    if (typeof obj.createdAt !== "string") {
      throw new Error("Malformed answer history entry: missing createdAt");
    }
    if (typeof obj.query !== "string") {
      throw new Error("Malformed answer history entry: missing query");
    }
    const result = obj.result as { ok?: unknown } | undefined;
    if (!result || typeof result.ok !== "boolean") {
      throw new Error("Malformed answer history entry: missing result.ok");
    }
  }
  return value as AnswerHistoryListResult;
}

function decodeAnswerHistoryShowResult(value: unknown): AnswerHistoryShowResult {
  if (!isObject(value)) {
    throw new Error("Malformed answer history show payload: not an object");
  }
  const obj = value as { ok?: unknown };
  if (obj.ok === false) {
    const reason = (value as { reason?: unknown }).reason;
    if (reason !== "not_found") {
      throw new Error(`Malformed answer history show payload: reason=${String(reason)}`);
    }
    return { ok: false, reason: "not_found" };
  }
  if (obj.ok === true) {
    const record = (value as { record?: unknown }).record;
    if (!isObject(record)) {
      throw new Error("Malformed answer history show payload: missing record");
    }
    const r = record as Record<string, unknown>;
    if (
      typeof r.id !== "string" ||
      typeof r.createdAt !== "string" ||
      typeof r.query !== "string"
    ) {
      throw new Error("Malformed answer history record: missing core fields");
    }
    return value as AnswerHistoryShowResult;
  }
  throw new Error("Malformed answer history show payload: ok not boolean");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// ---------------------------------------------------------------------------
// HTTP helpers — transport-bound free functions used by the core stub
// closures and by `DaemonControlClient` public class methods. They take a
// `DaemonTransport` and call its `baseUrl` / `authHeaders()` / `fetchRaw()`
// directly so closures can be assembled without a class instance.
// ---------------------------------------------------------------------------

async function captureHttp(
  transport: DaemonTransport,
  text: string,
  filter?: CaptureFilter,
): Promise<CaptureResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...transport.authHeaders() },
    body: JSON.stringify({ text, ...(filter && { filter }) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as CaptureResult;
}

async function retractHttp(
  transport: DaemonTransport,
  request: RetractRequest,
): Promise<RetractResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/retract`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...transport.authHeaders() },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as RetractResult;
}

async function recallHttp(
  transport: DaemonTransport,
  query: string,
  filter?: RecallFilter,
): Promise<RecallResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/recall`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...transport.authHeaders() },
    body: JSON.stringify({ query, ...(filter && { filter }) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as RecallResult;
}

async function answerHttp(
  transport: DaemonTransport,
  query: string,
  filter?: AnswerFilter,
): Promise<AnswerResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...transport.authHeaders() },
    body: JSON.stringify({ query, ...(filter && { filter }) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as AnswerResult;
}

async function answerLogHttp(
  transport: DaemonTransport,
  filter?: AnswerHistoryListFilter,
): Promise<AnswerHistoryListResult> {
  const params = new URLSearchParams();
  if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
  if (filter?.beforeId !== undefined) params.set("beforeId", filter.beforeId);
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetchWithTimeout(`${transport.baseUrl}/answers${query}`, {
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const decoded = (await res.json()) as unknown;
  return decodeAnswerHistoryListResult(decoded);
}

async function answerShowHttp(
  transport: DaemonTransport,
  id: string,
): Promise<AnswerHistoryShowResult> {
  const res = await fetchWithTimeout(
    `${transport.baseUrl}/answers/${encodeURIComponent(id)}`,
    { headers: transport.authHeaders() },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const decoded = (await res.json()) as unknown;
  return decodeAnswerHistoryShowResult(decoded);
}

async function listAuditHttp(
  transport: DaemonTransport,
  filter?: AuditListFilter,
): Promise<AuditListResult> {
  const params = new URLSearchParams();
  if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
  if (filter?.tool) params.set("tool", filter.tool);
  if (filter?.risk) params.set("risk", filter.risk);
  if (filter?.policy) params.set("policy", filter.policy);
  if (filter?.since) params.set("since", filter.since);
  if (filter?.session) params.set("session", filter.session);
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetchWithTimeout(`${transport.baseUrl}/audit${query}`, {
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as AuditListResult;
}

async function configValidateHttp(
  transport: DaemonTransport,
): Promise<ConfigValidateResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/config/validate`, {
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as ConfigValidateResult;
}

async function configGetHttp(
  transport: DaemonTransport,
  key: string,
): Promise<ConfigGetResult> {
  const res = await fetchWithTimeout(
    `${transport.baseUrl}/config/value?key=${encodeURIComponent(key)}`,
    { headers: transport.authHeaders() },
  );
  if (res.status === 404) return { found: false, reason: "not_found" };
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as ConfigGetResult;
}

async function configSetHttp(
  transport: DaemonTransport,
  key: string,
  rawValue: string,
): Promise<ConfigSetResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/config/value`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...transport.authHeaders() },
    body: JSON.stringify({ key, rawValue }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as ConfigSetResult;
}

async function configSchemaPathHttp(
  transport: DaemonTransport,
): Promise<{ path: string }> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/config/schema-path`, {
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as { path: string };
}

async function configSchemaContentHttp(
  transport: DaemonTransport,
): Promise<{ content: string }> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/config/schema`, {
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as { content: string };
}

async function modulesInspectHttp(
  transport: DaemonTransport,
  name: string,
): Promise<ModuleInspectResult> {
  const res = await fetchWithTimeout(
    `${transport.baseUrl}/modules/${encodeURIComponent(name)}`,
    { headers: transport.authHeaders() },
  );
  if (res.status === 404) return { found: false };
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as ModuleInspectResult;
}

async function modulesReloadHttp(
  transport: DaemonTransport,
  name: string,
): Promise<ModuleReloadResult> {
  const result = await reloadConfigHttp(transport);
  if (!result) return { ok: false, reason: "daemon_required" };
  const modulesRes = await listModulesHttp(transport);
  if (modulesRes && !modulesRes.modules.some((m) => m.name === name)) {
    return { ok: false, reason: "not_found" };
  }
  return {
    ok: true,
    reloaded: result.changedModules.includes(name),
    workflowsActive: result.workflows,
  };
}

async function doctorRunHttp(
  transport: DaemonTransport,
  options?: DoctorRunOptions,
): Promise<DoctorRunResult> {
  const params = new URLSearchParams();
  if (options?.skipConnectivity) params.set("skipConnectivity", "true");
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetchWithTimeout(`${transport.baseUrl}/doctor/run${query}`, {
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as DoctorRunResult;
}

async function doctorFixHttp(
  transport: DaemonTransport,
): Promise<DoctorFixResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/doctor/fix`, {
    method: "POST",
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as DoctorFixResult;
}

async function evalListHttp(
  transport: DaemonTransport,
): Promise<EvalListResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/eval/list`, {
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as EvalListResult;
}

async function evalRunHttp(
  transport: DaemonTransport,
  options?: EvalRunOptions,
): Promise<EvalRunResult> {
  const res = await fetch(`${transport.baseUrl}/api/eval/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...transport.authHeaders() },
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

async function evalCalibrationHttp(
  transport: DaemonTransport,
  options?: EvalCalibrationOptions,
): Promise<EvalCalibrationResult> {
  const params = new URLSearchParams();
  if (options?.windowDays !== undefined) params.set("windowDays", String(options.windowDays));
  if (options?.followUpDays !== undefined) params.set("followUpDays", String(options.followUpDays));
  if (options?.thresholdRate !== undefined) params.set("thresholdRate", String(options.thresholdRate));
  if (options?.minSample !== undefined) params.set("minSample", String(options.minSample));
  if (options?.runsDir) params.set("runsDir", options.runsDir);
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetchWithTimeout(`${transport.baseUrl}/eval/calibration${query}`, {
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as EvalCalibrationResult;
}

async function listWebhooksHttp(
  transport: DaemonTransport,
): Promise<WebhookListResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/webhooks`, {
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as WebhookListResult;
}

async function generateWebhookSecretHttp(
  transport: DaemonTransport,
  workflow: string,
): Promise<WebhookSecretGenerateResult> {
  const res = await fetchWithTimeout(
    `${transport.baseUrl}/webhooks/${encodeURIComponent(workflow)}/secret`,
    { method: "POST", headers: transport.authHeaders() },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as WebhookSecretGenerateResult;
}

async function removeWebhookSecretHttp(
  transport: DaemonTransport,
  workflow: string,
): Promise<WebhookSecretRemoveResult> {
  const res = await fetchWithTimeout(
    `${transport.baseUrl}/webhooks/${encodeURIComponent(workflow)}/secret`,
    { method: "DELETE", headers: transport.authHeaders() },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as WebhookSecretRemoveResult;
}

async function voiceTranscribeHttp(
  transport: DaemonTransport,
  input: {
    audio: Uint8Array;
    mimeType: string;
    filename?: string;
    languageHint?: string;
  },
): Promise<VoiceTranscribeResponse> {
  const body = {
    audioBase64: Buffer.from(input.audio).toString("base64"),
    mimeType: input.mimeType,
    ...(input.filename !== undefined && { filename: input.filename }),
    ...(input.languageHint !== undefined && { languageHint: input.languageHint }),
  };
  const res = await transport.fetchRaw("/voice/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

async function voiceSynthesizeHttp(
  transport: DaemonTransport,
  input: {
    text: string;
    voice?: string;
    languageHint?: string;
    format?: string;
  },
): Promise<VoiceSynthesizeResponse> {
  const res = await transport.fetchRaw("/voice/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

async function voiceTranscribeNamespaceHttp(
  transport: DaemonTransport,
  options: VoiceTranscribeOptions,
): Promise<VoiceTranscribeResult> {
  const result = await voiceTranscribeHttp(transport, options);
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

async function voiceSynthesizeNamespaceHttp(
  transport: DaemonTransport,
  options: VoiceSynthesizeOptions,
): Promise<VoiceSynthesizeResult> {
  const result = await voiceSynthesizeHttp(transport, options);
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

async function listAgentsHttp(
  transport: DaemonTransport,
): Promise<AgentsListResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/agents`, {
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as AgentsListResult;
}

async function inspectAgentHttp(
  transport: DaemonTransport,
  name: string,
): Promise<AgentInspectResult> {
  const res = await fetchWithTimeout(
    `${transport.baseUrl}/agents/${encodeURIComponent(name)}`,
    { headers: transport.authHeaders() },
  );
  if (res.status === 404) return { found: false };
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as AgentInspectResult;
}

async function listSkillsHttp(
  transport: DaemonTransport,
): Promise<SkillsListResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/skills`, {
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as SkillsListResult;
}

async function importSkillHttp(
  transport: DaemonTransport,
  source: string,
  options?: SkillImportOptions,
): Promise<SkillImportResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/skills/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...transport.authHeaders() },
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

async function listHarnessParityScenariosHttp(
  transport: DaemonTransport,
): Promise<HarnessParityListResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/harness-parity/scenarios`, {
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as HarnessParityListResult;
}

async function runHarnessParityHttp(
  transport: DaemonTransport,
  options?: HarnessParityRunOptions,
): Promise<HarnessParityRunResult> {
  const res = await fetch(`${transport.baseUrl}/harness-parity/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...transport.authHeaders() },
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

async function listSessionsHttp(
  transport: DaemonTransport,
): Promise<{ sessions: InteractiveSession[] } | null> {
  try {
    const res = await fetchWithTimeout(`${transport.baseUrl}/sessions`, {
      headers: transport.authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as { sessions: InteractiveSession[] };
  } catch {
    return null;
  }
}

async function setSessionAutonomyModeHttp(
  transport: DaemonTransport,
  id: string,
  mode: AutonomyMode,
): Promise<SessionsSetAutonomyModeResult> {
  try {
    const res = await fetchWithTimeout(`${transport.baseUrl}/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...transport.authHeaders() },
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

async function listModulesHttp(
  transport: DaemonTransport,
): Promise<{ modules: ModuleListEntry[] } | null> {
  try {
    const res = await fetchWithTimeout(`${transport.baseUrl}/modules`, {
      headers: transport.authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as { modules: ModuleListEntry[] };
  } catch {
    return null;
  }
}

async function listKnowledgeHttp(
  transport: DaemonTransport,
  filter?: KnowledgeListFilter,
): Promise<KnowledgeListResult> {
  const params = new URLSearchParams();
  if (filter?.tag) params.set("tag", filter.tag);
  if (filter?.type) params.set("type", filter.type);
  if (filter?.status) params.set("status", filter.status);
  if (filter?.scope) params.set("scope", filter.scope);
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetchWithTimeout(`${transport.baseUrl}/api/knowledge${query}`, {
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { entries: KnowledgeEntry[] };
  return { entries: body.entries };
}

async function showKnowledgeHttp(
  transport: DaemonTransport,
  id: string,
): Promise<KnowledgeShowResult> {
  const res = await fetchWithTimeout(
    `${transport.baseUrl}/api/knowledge/${encodeURIComponent(id)}`,
    { headers: transport.authHeaders() },
  );
  if (res.status === 404) return { found: false };
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const entry = (await res.json()) as KnowledgeEntry;
  return { found: true, entry };
}

async function searchKnowledgeHttp(
  transport: DaemonTransport,
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
    `${transport.baseUrl}/api/knowledge/search?${params.toString()}`,
    { headers: transport.authHeaders() },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as KnowledgeSearchResult;
}

async function addKnowledgeHttp(
  transport: DaemonTransport,
  options: KnowledgeAddOptions,
): Promise<KnowledgeAddResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/api/knowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...transport.authHeaders() },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { id: string };
  return { id: body.id };
}

async function deleteKnowledgeHttp(
  transport: DaemonTransport,
  id: string,
): Promise<KnowledgeDeleteResult> {
  const res = await fetchWithTimeout(
    `${transport.baseUrl}/api/knowledge/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: transport.authHeaders() },
  );
  if (res.status === 404) return { ok: false, reason: "not_found" };
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return { ok: true };
}

async function reindexKnowledgeHttp(
  transport: DaemonTransport,
): Promise<KnowledgeReindexResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/api/knowledge/reindex`, {
    method: "POST",
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as KnowledgeReindexResult;
}

async function historyListHttp(
  transport: DaemonTransport,
  filter?: HistoryListFilter,
): Promise<HistoryListResult> {
  const params = new URLSearchParams();
  if (filter?.search) params.set("search", filter.search);
  if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
  if (filter?.cwd) params.set("cwd", filter.cwd);
  if (filter?.source) params.set("source", filter.source);
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetchWithTimeout(`${transport.baseUrl}/history${query}`, {
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as HistoryListResult;
}

async function historyShowHttp(
  transport: DaemonTransport,
  id: string,
): Promise<HistoryShowResult> {
  const res = await fetchWithTimeout(
    `${transport.baseUrl}/history/${encodeURIComponent(id)}`,
    { headers: transport.authHeaders() },
  );
  if (res.status === 404) return { found: false };
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as ConversationData;
  return { found: true, data };
}

async function historyDeleteHttp(
  transport: DaemonTransport,
  id: string,
): Promise<HistoryDeleteResult> {
  const res = await fetchWithTimeout(
    `${transport.baseUrl}/history/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: transport.authHeaders() },
  );
  if (res.status === 204) return { ok: true };
  if (res.status === 404) return { ok: false, reason: "not_found" };
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? `HTTP ${res.status}`);
}

async function reindexHistoryHttp(
  transport: DaemonTransport,
): Promise<HistoryReindexResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/history/reindex`, {
    method: "POST",
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as HistoryReindexResult;
}

async function searchHistoryHttp(
  transport: DaemonTransport,
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
    `${transport.baseUrl}/api/history/search?${params.toString()}`,
    { headers: transport.authHeaders() },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as HistorySearchResult;
}

async function answerOwnerQuestionHttp(
  transport: DaemonTransport,
  id: string,
  answer: string,
): Promise<OwnerQuestionMutateResult> {
  try {
    const res = await fetchWithTimeout(
      `${transport.baseUrl}/owner-questions/${encodeURIComponent(id)}/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...transport.authHeaders() },
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

async function dismissOwnerQuestionHttp(
  transport: DaemonTransport,
  id: string,
  reason?: string,
): Promise<OwnerQuestionMutateResult> {
  try {
    const res = await fetchWithTimeout(
      `${transport.baseUrl}/owner-questions/${encodeURIComponent(id)}/dismiss`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...transport.authHeaders() },
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

async function listOwnerQuestionsHttp(
  transport: DaemonTransport,
  status?: OwnerQuestionStatus | "all",
): Promise<{ questions: PendingOwnerQuestion[] } | null> {
  try {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    const res = await fetchWithTimeout(`${transport.baseUrl}/owner-questions${query}`, {
      headers: transport.authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as { questions: PendingOwnerQuestion[] };
  } catch {
    return null;
  }
}

async function addMemoryHttp(
  transport: DaemonTransport,
  content: string,
  tags: string[],
): Promise<MemoryAddResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/api/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...transport.authHeaders() },
    body: JSON.stringify({ content, tags }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { id: string };
  return { id: body.id };
}

async function deleteMemoryHttp(
  transport: DaemonTransport,
  id: string,
): Promise<MemoryDeleteResult> {
  const res = await fetchWithTimeout(
    `${transport.baseUrl}/api/memory/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: transport.authHeaders() },
  );
  if (res.status === 404) return { ok: false, reason: "not_found" };
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return { ok: true };
}

async function searchMemoryHttp(
  transport: DaemonTransport,
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
    `${transport.baseUrl}/api/memory/search?${params.toString()}`,
    { headers: transport.authHeaders() },
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

async function reindexMemoryHttp(
  transport: DaemonTransport,
): Promise<MemoryReindexResult> {
  const res = await fetchWithTimeout(`${transport.baseUrl}/api/memory/reindex`, {
    method: "POST",
    headers: transport.authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as MemoryReindexResult;
}

async function listSecretsHttp(
  transport: DaemonTransport,
): Promise<{ secrets: { name: string; source: string }[] } | null> {
  try {
    const res = await fetchWithTimeout(`${transport.baseUrl}/api/secrets`, {
      headers: transport.authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as { secrets: { name: string; source: string }[] };
  } catch {
    return null;
  }
}

async function getSecretHttp(
  transport: DaemonTransport,
  name: string,
): Promise<SecretGetResult> {
  try {
    const res = await fetchWithTimeout(
      `${transport.baseUrl}/api/secrets/${encodeURIComponent(name)}`,
      { headers: transport.authHeaders() },
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

async function setSecretHttp(
  transport: DaemonTransport,
  name: string,
  value: string,
  scope: SecretScope,
): Promise<SecretMutateResult> {
  try {
    const res = await fetchWithTimeout(
      `${transport.baseUrl}/api/secrets/${encodeURIComponent(name)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...transport.authHeaders() },
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

async function removeSecretHttp(
  transport: DaemonTransport,
  name: string,
  scope: SecretScope,
): Promise<SecretMutateResult> {
  try {
    const res = await fetchWithTimeout(
      `${transport.baseUrl}/api/secrets/${encodeURIComponent(name)}?scope=${encodeURIComponent(scope)}`,
      { method: "DELETE", headers: transport.authHeaders() },
    );
    if (res.status === 404) return { ok: false, reason: "not_found" };
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, reason: "store_error", message: body.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: "store_error", message: (err as Error).message };
  }
}

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

async function listMemoryHttp(
  transport: DaemonTransport,
): Promise<{ entries: { id: string; tags: string[]; created: string; excerpt: string }[] } | null> {
  try {
    const res = await fetchWithTimeout(`${transport.baseUrl}/api/memory`, {
      headers: transport.authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as { entries: { id: string; tags: string[]; created: string; excerpt: string }[] };
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

function listApprovalsHttp(
  transport: DaemonTransport,
  status?: ApprovalStatus | "all",
): Promise<{ approvals: PendingApproval[] } | null> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return transport.request("GET", `/approvals${query}`);
}

function approveApprovalHttp(
  transport: DaemonTransport,
  id: string,
  note?: string,
): Promise<{ approval: PendingApproval } | null> {
  return transport.request("POST", `/approvals/${encodeURIComponent(id)}/approve`, { note });
}

function rejectApprovalHttp(
  transport: DaemonTransport,
  id: string,
  reason?: string,
): Promise<{ approval: PendingApproval } | null> {
  return transport.request("POST", `/approvals/${encodeURIComponent(id)}/reject`, { reason });
}

/**
 * The OS-managed daemon flag is filesystem-scoped (it checks for a
 * launchd plist or systemd unit on the operator host). The daemon
 * cannot answer that for the calling host, so the daemon-up branch
 * always reports `false`; the local handler is the one that probes
 * the operator filesystem.
 */
async function daemonManagedHttp(): Promise<boolean> {
  return false;
}

// ---------------------------------------------------------------------------
// Core stub: the 27 namespace closures that have not yet migrated to their
// owning module's `daemonClient(link)` factory. Module-contributed handlers
// override the same namespace at assembly time. As each namespace migrates
// out, its closure is removed from the stub.
// ---------------------------------------------------------------------------

/**
 * Build the core-side stub `DaemonClientHandlers` map from a typed
 * `DaemonTransport`. Each closure corresponds to a `KotaClient` namespace
 * that has not yet been migrated to its owning module.
 *
 * `kota serve` and `kota mcp-server` start a long-running process in the
 * caller's address space. The daemon cannot start either on the caller's
 * behalf, so the `web` and `mcpServer` namespaces surface
 * `daemon_required` uniformly when the selector picked the daemon
 * transport. The CLI maps that to a clear "stop the daemon first" hint.
 *
 * The daemon-up `daemonOps` namespace always reports `running` because
 * the client only exists when the selector resolved to a daemon address.
 * The local handler is the one that distinguishes "not running" from
 * "stale control file"; the daemon-up branch never sees those states.
 */
export function buildCoreStubDaemonClientHandlers(
  transport: DaemonTransport,
): DaemonClientHandlers {
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
    approvals: {
      list: async (filter) => {
        const result = await listApprovalsHttp(transport, filter?.status);
        return { approvals: result?.approvals ?? [] };
      },
      approve: async (id, note) => {
        const result = await approveApprovalHttp(transport, id, note);
        return result ? { ok: true, approval: result.approval } : { ok: false, reason: "not_found" };
      },
      reject: async (id, reason) => {
        const result = await rejectApprovalHttp(transport, id, reason);
        return result ? { ok: true, approval: result.approval } : { ok: false, reason: "not_found" };
      },
    },
    secrets: {
      list: async () => {
        const result = await listSecretsHttp(transport);
        return { secrets: result?.secrets ?? [] };
      },
      get: async (name) => getSecretHttp(transport, name),
      set: async (name, value, scope) => setSecretHttp(transport, name, value, scope),
      remove: async (name, scope) => removeSecretHttp(transport, name, scope),
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
    memory: {
      list: async (limit) => {
        const result = await listMemoryHttp(transport);
        const slice = result ? result.entries.slice(0, limit ?? Number.POSITIVE_INFINITY) : [];
        return {
          entries: slice.map((entry) => ({
            id: entry.id,
            created: entry.created,
            content: entry.excerpt,
          })),
        };
      },
      add: async (content, tags) => addMemoryHttp(transport, content, tags ?? []),
      delete: async (id) => deleteMemoryHttp(transport, id),
      search: async (query, filter) => searchMemoryHttp(transport, query, filter),
      reindex: async () => reindexMemoryHttp(transport),
    },
    ownerQuestions: {
      list: async (filter) => {
        const result = await listOwnerQuestionsHttp(transport, filter?.status);
        return { questions: result?.questions ?? [] };
      },
      answer: async (id, answer) => answerOwnerQuestionHttp(transport, id, answer),
      dismiss: async (id, reason) => dismissOwnerQuestionHttp(transport, id, reason),
    },
    history: {
      list: async (filter) => historyListHttp(transport, filter),
      show: async (id) => historyShowHttp(transport, id),
      delete: async (id) => historyDeleteHttp(transport, id),
      search: async (query, filter) => searchHistoryHttp(transport, query, filter),
      reindex: async () => reindexHistoryHttp(transport),
    },
    knowledge: {
      list: async (filter) => listKnowledgeHttp(transport, filter),
      show: async (id) => showKnowledgeHttp(transport, id),
      search: async (query, filter) => searchKnowledgeHttp(transport, query, filter),
      add: async (options) => addKnowledgeHttp(transport, options),
      delete: async (id) => deleteKnowledgeHttp(transport, id),
      reindex: async () => reindexKnowledgeHttp(transport),
    },
    sessions: {
      list: async () => {
        const result = await listSessionsHttp(transport);
        if (!result) throw new Error("Daemon unreachable while listing sessions");
        return { sessions: result.sessions };
      },
      setAutonomyMode: async (id, mode) => setSessionAutonomyModeHttp(transport, id, mode),
    },
    modules: {
      list: async () => {
        const result = await listModulesHttp(transport);
        if (!result) throw new Error("Daemon unreachable while listing modules");
        return { modules: result.modules };
      },
    },
    agents: {
      list: async () => listAgentsHttp(transport),
      inspect: async (name) => inspectAgentHttp(transport, name),
    },
    skills: {
      list: async () => listSkillsHttp(transport),
      import: async (source, options) => importSkillHttp(transport, source, options),
    },
    harnessParity: {
      list: async () => listHarnessParityScenariosHttp(transport),
      run: async (options) => runHarnessParityHttp(transport, options),
    },
    webhook: {
      list: async () => listWebhooksHttp(transport),
      secretGenerate: async (workflow) => generateWebhookSecretHttp(transport, workflow),
      secretRemove: async (workflow) => removeWebhookSecretHttp(transport, workflow),
    },
    voice: {
      transcribe: async (options) => voiceTranscribeNamespaceHttp(transport, options),
      synthesize: async (options) => voiceSynthesizeNamespaceHttp(transport, options),
    },
    web: {
      start: async (_options): Promise<WebStartResult> => ({ ok: false, reason: "daemon_required" }),
    },
    mcpServer: {
      start: async (_options): Promise<McpServerStartResult> => ({ ok: false, reason: "daemon_required" }),
    },
    audit: {
      list: async (filter) => listAuditHttp(transport, filter),
    },
    config: {
      validate: async () => configValidateHttp(transport),
      get: async (key) => configGetHttp(transport, key),
      set: async (key, rawValue) => configSetHttp(transport, key, rawValue),
      schemaPath: async () => configSchemaPathHttp(transport),
      schemaContent: async () => configSchemaContentHttp(transport),
    },
    modulesAdmin: {
      inspect: async (name) => modulesInspectHttp(transport, name),
      reload: async (name) => modulesReloadHttp(transport, name),
    },
    daemonOps: {
      status: async () => {
        const status = await getDaemonStatusHttp(transport);
        if (!status) {
          throw new Error("Daemon unreachable while reading daemon status");
        }
        const managed = await daemonManagedHttp();
        return { state: "running", managed, status };
      },
      pid: async () => {
        const status = await getDaemonStatusHttp(transport);
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
        const result = await reloadConfigHttp(transport);
        if (!result) return { ok: false, reason: "reload_failed" };
        return { ok: true, workflows: result.workflows, changedModules: result.changedModules };
      },
    },
    doctor: {
      run: async (options) => doctorRunHttp(transport, options),
      fix: async () => doctorFixHttp(transport),
    },
    evalHarness: {
      list: async () => evalListHttp(transport),
      run: async (options) => evalRunHttp(transport, options),
      calibration: async (options) => evalCalibrationHttp(transport, options),
    },
    recall: {
      recall: async (query, filter) => recallHttp(transport, query, filter),
    },
    answer: {
      answer: async (query, filter) => answerHttp(transport, query, filter),
      log: async (filter) => answerLogHttp(transport, filter),
      show: async (id) => answerShowHttp(transport, id),
    },
    capture: {
      capture: async (text, filter) => captureHttp(transport, text, filter),
    },
    retract: {
      retract: async (request) => retractHttp(transport, request),
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

  static fromStateDir(stateDir?: string): DaemonControlClient | null {
    const dir = stateDir ?? join(resolveProjectDir(), ".kota");
    const address = readOptionalJsonFile<DaemonControlAddress>(join(dir, "daemon-control.json"));
    if (!address || typeof address.port !== "number") return null;
    return DaemonControlClient.fromAddress(address);
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

  async listHistory(filter?: HistoryListFilter): Promise<HistoryListResult | null> {
    try {
      return await historyListHttp(this.transport, filter);
    } catch {
      return null;
    }
  }

  async getHistory(id: string): Promise<ConversationData | null> {
    try {
      const result = await historyShowHttp(this.transport, id);
      return result.found ? result.data : null;
    } catch {
      return null;
    }
  }

  async deleteHistory(id: string): Promise<boolean> {
    try {
      const result = await historyDeleteHttp(this.transport, id);
      return result.ok;
    } catch {
      return false;
    }
  }

  listApprovals(status?: ApprovalStatus | "all"): Promise<{ approvals: PendingApproval[] } | null> {
    return listApprovalsHttp(this.transport, status);
  }

  approveApproval(id: string, note?: string): Promise<{ approval: PendingApproval } | null> {
    return approveApprovalHttp(this.transport, id, note);
  }

  rejectApproval(id: string, reason?: string): Promise<{ approval: PendingApproval } | null> {
    return rejectApprovalHttp(this.transport, id, reason);
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

  listOwnerQuestions(status?: OwnerQuestionStatus | "all"): Promise<{ questions: PendingOwnerQuestion[] } | null> {
    return listOwnerQuestionsHttp(this.transport, status);
  }

  async registerSession(id: string, createdAt: string, autonomyMode: AutonomyMode): Promise<boolean> {
    const resp = await safeFetchRaw(this.transport, "POST", "/sessions/register", { id, createdAt, autonomyMode });
    return resp?.ok ?? false;
  }

  async setSessionAutonomyMode(id: string, autonomyMode: AutonomyMode): Promise<{
    ok: boolean;
    notFound?: boolean;
    autonomyMode?: AutonomyMode;
    source?: string;
    serveOwned?: boolean;
  } | null> {
    const resp = await safeFetchRaw(this.transport, "PATCH", `/sessions/${encodeURIComponent(id)}`, {
      autonomy_mode: autonomyMode,
    });
    if (!resp) return null;
    if (resp.status === 404) return { ok: false, notFound: true };
    if (!resp.ok) return null;
    const body = (await resp.json()) as { autonomy_mode?: string; source?: string; serveOwned?: boolean };
    return {
      ok: true,
      autonomyMode: (body.autonomy_mode ?? autonomyMode) as AutonomyMode,
      source: body.source,
      serveOwned: body.serveOwned,
    };
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

  voiceTranscribe(input: {
    audio: Uint8Array;
    mimeType: string;
    filename?: string;
    languageHint?: string;
  }): Promise<VoiceTranscribeResponse> {
    return voiceTranscribeHttp(this.transport, input);
  }

  voiceSynthesize(input: {
    text: string;
    voice?: string;
    languageHint?: string;
    format?: string;
  }): Promise<VoiceSynthesizeResponse> {
    return voiceSynthesizeHttp(this.transport, input);
  }

  events(): AsyncGenerator<DaemonSseEvent> {
    return this.transport.events();
  }
}
