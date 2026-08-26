/**
 * Authored daemon/thin-client contract graph.
 *
 * Shapes are references to their TypeScript domain owners through
 * `DaemonWireContract`; this graph owns transport identity (method/path),
 * binding names, capability ids, and the generated KotaClient aggregate.
 */

export const DAEMON_CONTRACT_VERSION = "daemon.contract.v1";
export const DAEMON_WIRE_SOURCE = "src/client/wire-contracts.ts";
export const DAEMON_WIRE_ROOT_TYPE = "DaemonWireContract";

export const KOTA_CLIENT_NAMESPACE_GRAPH = [
  ["workflow", "WorkflowClient", "#modules/workflow-ops/client.js"],
  ["approvals", "ApprovalsClient", "#modules/approval-queue/client.js"],
  ["secrets", "SecretsClient", "#modules/secrets/client.js"],
  ["tasks", "RepoTasksClient", "#modules/repo-tasks/client.js"],
  ["memory", "MemoryClient", "#modules/memory/client.js"],
  ["ownerDecisions", "OwnerDecisionsClient", "#modules/owner-decisions/client.js"],
  ["ownerQuestions", "OwnerQuestionsClient", "#modules/owner-questions/client.js"],
  ["history", "HistoryClient", "#modules/history/client.js"],
  ["inboundSignals", "InboundSignalsClient", "#modules/inbound-signals/client.js"],
  ["knowledge", "KnowledgeClient", "#modules/knowledge/client.js"],
  ["sessions", "SessionsClient", "#modules/daemon-ops/client.js"],
  ["modules", "ModulesClient", "#modules/module-manager/client.js"],
  ["agents", "AgentsClient", "#modules/agent-ops/client.js"],
  ["skills", "SkillsClient", "#modules/skill-ops/client.js"],
  ["harnessParity", "HarnessParityClient", "#modules/harness-parity/client.js"],
  ["webhook", "WebhookClient", "#modules/webhook/client.js"],
  ["voice", "VoiceClient", "#modules/voice/client.js"],
  ["web", "WebClient", "#modules/web/client.js"],
  ["mcpServer", "McpServerClient", "#modules/mcp-server/client.js"],
  ["audit", "AuditClient", "#modules/guardrails-audit/client.js"],
  ["config", "ConfigClient", "#modules/config/client.js"],
  ["modulesAdmin", "ModulesAdminClient", "#modules/module-manager/client.js"],
  ["daemonOps", "DaemonOpsClient", "#modules/daemon-ops/client.js"],
  ["scopes", "ScopesClient", "#modules/daemon-ops/client.js"],
  ["ui", "UiClient", "#modules/daemon-ops/client.js"],
  ["doctor", "DoctorClient", "#modules/doctor/client.js"],
  ["evalHarness", "EvalHarnessClient", "#modules/eval-harness/client.js"],
  ["recall", "RecallClient", "#modules/recall/client.js"],
  ["resourceDiscovery", "ResourceDiscoveryClient", "#modules/resource-discovery/client.js"],
  ["answer", "AnswerClient", "#modules/answer/client.js"],
  ["capture", "CaptureClient", "#modules/capture/client.js"],
  ["retract", "RetractClient", "#modules/retract/client.js"],
  ["setup", "SetupClient", "#modules/setup/client.js"],
];

export const DAEMON_ROUTE_GRAPH = [
  { id: "identity", method: "GET", path: "/identity", type: "ClientIdentity", parser: "parseClientIdentity" },
  { id: "scopeRegistry", method: "GET", path: "/scopes", type: "ScopeRegistryProjection", parser: "parseScopeRegistryProjection" },
  { id: "scopePolicy", method: "GET", path: "/scopes/:scopeId/policy", type: "ScopePolicyRouteResponse", parser: "parseScopePolicyRouteResponse" },
  { id: "unknownScopeError", method: "ERROR", path: "unknown_scope", type: "UnknownScopeError", parser: "parseUnknownScopeError" },
  { id: "capabilities", method: "GET", path: "/capabilities", type: "CapabilityReadinessResponse", parser: "parseCapabilityReadinessResponse" },
  { id: "setupStatus", method: "GET", path: "/setup/requirements", type: "SetupStatusResponse", parser: "parseSetupStatusResponse" },
  { id: "recall", method: "POST", path: "/recall", type: "RecallResult", parser: "parseRecallResult" },
  { id: "answer", method: "POST", path: "/answer", type: "AnswerResult", parser: "parseAnswerResult" },
  { id: "answerHistoryList", method: "GET", path: "/answers", type: "AnswerHistoryListResult", parser: "parseAnswerHistoryListResult" },
  { id: "answerHistoryShow", method: "GET", path: "/answers/:id", type: "AnswerHistoryShowResult", parser: "parseAnswerHistoryShowResult" },
  { id: "capture", method: "POST", path: "/capture", type: "CaptureResult", parser: "parseCaptureResult" },
  { id: "retract", method: "POST", path: "/retract", type: "RetractResult", parser: "parseRetractResult" },
  { id: "knowledgeSearch", method: "GET", path: "/knowledge/search", type: "KnowledgeSearchResponse", parser: "parseKnowledgeSearchResponse" },
  { id: "memorySearch", method: "GET", path: "/memory/search", type: "MemorySearchResponse", parser: "parseMemorySearchResponse" },
  { id: "historySearch", method: "GET", path: "/history/search", type: "HistorySearchResponse", parser: "parseHistorySearchResponse" },
  { id: "tasksSearch", method: "GET", path: "/tasks/search", type: "TasksSearchResponse", parser: "parseTasksSearchResponse" },
  { id: "attention", method: "GET", path: "/attention", type: "AttentionResponse", parser: "parseAttentionResponse" },
  { id: "digest", method: "GET", path: "/digest", type: "DigestResponse", parser: "parseDigestResponse" },
  { id: "voiceTranscribe", method: "POST", path: "/voice/transcribe", type: "VoiceTranscribeResult", parser: "parseVoiceTranscribeResult" },
  { id: "voiceFailure", method: "POST", path: "/voice/synthesize", type: "VoiceFailure", parser: "parseVoiceFailure" },
];

export const DAEMON_TYPE_ALIASES = {
  SetupStatusResponse: "ModuleSetupStatusResponse",
  KnowledgeSearchResponse: "KnowledgeSearchResult",
  MemorySearchResponse: "MemorySearchResult",
  HistorySearchResponse: "HistorySearchResult",
  TasksSearchResponse: "RepoTaskSearchResult",
  AttentionResponse: "RenderedAttention",
  DigestData: "DailyDigestData",
  DigestQueueCounts: "QueueCounts",
  DigestQueueDelta: "QueueDelta",
  VoiceTranscribeResult: "VoiceTranscribeResponse",
};

export const DAEMON_EVENT_GRAPH = [
  "workflow.started",
  "workflow.completed",
  "workflow.step.completed",
  "queue.changed",
  "approval.changed",
  "task.changed",
  "session.registered",
  "session.unregistered",
  "workflow.failure.alert",
  "owner.question.asked",
  "owner.question.changed",
  "owner.question.resolved",
  "owner.question.dismissed",
  "owner.question.expired",
];

export const DAEMON_CAPABILITY_GRAPH = ["dashboard", "workflow.trigger"];
