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

export const DAEMON_OPERATION_DESCRIPTORS = [
  // agents (agent-ops)
  { id: "agents.list", namespace: "agents", clientMethod: "list", method: "GET", path: "/agents", classification: "routine", responseType: "AgentsListResult" },
  { id: "agents.inspect", namespace: "agents", clientMethod: "inspect", method: "GET", path: "/agents/:name", classification: "routine", responseType: "AgentInspectResult", parameters: [{ name: "name", type: "path" }] },

  // skills (skill-ops)
  { id: "skills.list", namespace: "skills", clientMethod: "list", method: "GET", path: "/skills", classification: "routine", responseType: "SkillsListResult" },
  { id: "skills.import", namespace: "skills", clientMethod: "import", method: "POST", path: "/skills/import", classification: "routine", responseType: "SkillImportResult", parameters: [{ name: "source", type: "body" }, { name: "options", type: "bodySpread", optional: true }] },

  // recall (recall)
  { id: "recall.recall", namespace: "recall", clientMethod: "recall", method: "POST", path: "/recall", classification: "routine", responseType: "RecallResult", parameters: [{ name: "query", type: "body" }, { name: "filter", type: "bodyFilter", optional: true }] },

  // capture (capture)
  { id: "capture.capture", namespace: "capture", clientMethod: "capture", method: "POST", path: "/capture", classification: "routine", responseType: "CaptureResult", parameters: [{ name: "text", type: "body" }, { name: "filter", type: "bodyFilter", optional: true }] },

  // retract (retract)
  { id: "retract.retract", namespace: "retract", clientMethod: "retract", method: "POST", path: "/retract", classification: "routine", responseType: "RetractResult", parameters: [{ name: "request", type: "bodyDirect" }] },

  // resourceDiscovery (resource-discovery)
  { id: "resourceDiscovery.discover", namespace: "resourceDiscovery", clientMethod: "discover", method: "POST", path: "/resource-discovery", classification: "routine", responseType: "ResourceDiscoveryResult", parameters: [{ name: "query", type: "body" }, { name: "filter", type: "bodyFilter", optional: true }] },

  // doctor (doctor)
  { id: "doctor.run", namespace: "doctor", clientMethod: "run", method: "GET", path: "/doctor/run", classification: "routine", responseType: "DoctorRunResult", parameters: [{ name: "options", type: "queryOptions", optional: true }] },
  { id: "doctor.fix", namespace: "doctor", clientMethod: "fix", method: "POST", path: "/doctor/fix", classification: "routine", responseType: "DoctorFixResult" },

  // audit (guardrails-audit)
  { id: "audit.list", namespace: "audit", clientMethod: "list", method: "GET", path: "/audit", classification: "routine", responseType: "AuditListResult", parameters: [{ name: "filter", type: "queryOptions", optional: true }] },

  // webhook (webhook)
  { id: "webhook.list", namespace: "webhook", clientMethod: "list", method: "GET", path: "/webhooks", classification: "routine", responseType: "WebhookListResult" },
  { id: "webhook.secretGenerate", namespace: "webhook", clientMethod: "secretGenerate", method: "POST", path: "/webhooks/:workflow/secret", classification: "routine", responseType: "WebhookSecretGenerateResult", parameters: [{ name: "workflow", type: "path" }] },
  { id: "webhook.secretRemove", namespace: "webhook", clientMethod: "secretRemove", method: "DELETE", path: "/webhooks/:workflow/secret", classification: "routine", responseType: "WebhookSecretRemoveResult", parameters: [{ name: "workflow", type: "path" }] },

  // modules & modulesAdmin (module-manager)
  { id: "modules.list", namespace: "modules", clientMethod: "list", method: "GET", path: "/modules", classification: "routine", responseType: "ModulesListResult" },
  { id: "modulesAdmin.inspect", namespace: "modulesAdmin", clientMethod: "inspect", method: "GET", path: "/modules/:name", classification: "routine", responseType: "ModuleInspectResult", parameters: [{ name: "name", type: "path" }] },
  { id: "modulesAdmin.reload", namespace: "modulesAdmin", clientMethod: "reload", method: "POST", path: "/modules/:name/reload", classification: "routine", responseType: "ModuleReloadResult", parameters: [{ name: "name", type: "path" }] },

  // inboundSignals (inbound-signals)
  { id: "inboundSignals.listRoutes", namespace: "inboundSignals", clientMethod: "listRoutes", method: "GET", path: "/inbound-signals/routes", classification: "routine", responseType: "InboundSignalRouteListResult", parameters: [{ name: "scopeSelector", type: "scopeQuery", optional: true }] },
  { id: "inboundSignals.validateRoutes", namespace: "inboundSignals", clientMethod: "validateRoutes", method: "GET", path: "/inbound-signals/routes", classification: "routine", responseType: "InboundSignalRouteValidationResult", derivedFrom: "listRoutes", parameters: [{ name: "scopeSelector", type: "scopeQuery", optional: true }] },

  // answer (answer)
  { id: "answer.answer", namespace: "answer", clientMethod: "answer", method: "POST", path: "/answer", classification: "routine", responseType: "AnswerResult", parameters: [{ name: "query", type: "body" }, { name: "filter", type: "bodyFilter", optional: true }] },
  { id: "answer.log", namespace: "answer", clientMethod: "log", method: "GET", path: "/answers", classification: "routine", responseType: "AnswerHistoryListResult", responseDecoder: "decodeAnswerHistoryListResult", parameters: [{ name: "filter", type: "queryOptions", optional: true }] },
  { id: "answer.show", namespace: "answer", clientMethod: "show", method: "GET", path: "/answers/:id", classification: "routine", responseType: "AnswerHistoryShowResult", responseDecoder: "decodeAnswerHistoryShowResult", parameters: [{ name: "id", type: "path" }, { name: "scope", type: "queryOptions", optional: true }] },

  // approvals (approval-queue) - Classified Exceptions
  { id: "approvals.list", namespace: "approvals", clientMethod: "list", method: "GET", path: "/approvals", classification: "routine", responseType: "ApprovalsListResult" },
  { id: "approvals.approve", namespace: "approvals", clientMethod: "approve", method: "POST", path: "/approvals/:id/approve", classification: "exception", exceptionReason: "security: reviewDigest matching, lease binding, tool-call output redaction verification, and status code mapping (400, 404, 409)" },
  { id: "approvals.reject", namespace: "approvals", clientMethod: "reject", method: "POST", path: "/approvals/:id/reject", classification: "exception", exceptionReason: "security: lease binding and status code mapping (400, 404, 409)" },

  // secrets (secrets) - Classified Exceptions
  { id: "secrets.list", namespace: "secrets", clientMethod: "list", method: "GET", path: "/api/secrets", classification: "routine", responseType: "SecretListResult" },
  { id: "secrets.get", namespace: "secrets", clientMethod: "get", method: "GET", path: "/api/secrets/:name", classification: "routine", responseType: "SecretGetResult" },
  { id: "secrets.set", namespace: "secrets", clientMethod: "set", method: "PUT", path: "/api/secrets/:name", classification: "exception", exceptionReason: "semantic-transform: catches mutation failure exceptions and normalizes to SecretMutateResult failure union" },
  { id: "secrets.remove", namespace: "secrets", clientMethod: "remove", method: "DELETE", path: "/api/secrets/:name", classification: "exception", exceptionReason: "semantic-transform: catches mutation failure exceptions and normalizes to SecretMutateResult failure union" },

  // tasks (repo-tasks) - Classified Exceptions
  { id: "tasks.list", namespace: "tasks", clientMethod: "list", method: "GET", path: "/api/tasks", classification: "exception", exceptionReason: "semantic-transform: task state machine projection and client-side state filtering" },
  { id: "tasks.show", namespace: "tasks", clientMethod: "show", method: "GET", path: "/api/tasks/:id", classification: "exception", exceptionReason: "semantic-transform: 404 to found:false domain union" },
  { id: "tasks.move", namespace: "tasks", clientMethod: "move", method: "POST", path: "/api/tasks/:id/move", classification: "exception", exceptionReason: "semantic-transform: 409 already_in_state/terminal conflict mapping and 400 invalid_id translation" },
  { id: "tasks.updateBody", namespace: "tasks", clientMethod: "updateBody", method: "PUT", path: "/api/tasks/:id/body", classification: "exception", exceptionReason: "semantic-transform: multi-step fetch and revision conflict handling" },
  { id: "tasks.create", namespace: "tasks", clientMethod: "create", method: "POST", path: "/api/tasks/normalized", classification: "exception", exceptionReason: "semantic-transform: 400/409 validation and duplicate task ID conflict mapping" },
  { id: "tasks.capture", namespace: "tasks", clientMethod: "capture", method: "POST", path: "/api/tasks/capture", classification: "exception", exceptionReason: "semantic-transform: 400/409 error envelope extraction" },
  { id: "tasks.search", namespace: "tasks", clientMethod: "search", method: "GET", path: "/tasks/search", classification: "routine", responseType: "RepoTaskSearchResult" },
  { id: "tasks.reindex", namespace: "tasks", clientMethod: "reindex", method: "POST", path: "/tasks/reindex", classification: "routine", responseType: "RepoTaskReindexResult" },

  // memory (memory) - Classified Exceptions
  { id: "memory.list", namespace: "memory", clientMethod: "list", method: "GET", path: "/api/memory", classification: "routine", responseType: "MemoryListResult" },
  { id: "memory.add", namespace: "memory", clientMethod: "add", method: "POST", path: "/api/memory", classification: "routine", responseType: "MemoryAddResult" },
  { id: "memory.delete", namespace: "memory", clientMethod: "delete", method: "DELETE", path: "/api/memory/:id", classification: "exception", exceptionReason: "semantic-transform: 404 to not_found domain union" },
  { id: "memory.search", namespace: "memory", clientMethod: "search", method: "GET", path: "/api/memory/search", classification: "routine", responseType: "MemorySearchResult" },
  { id: "memory.reindex", namespace: "memory", clientMethod: "reindex", method: "POST", path: "/api/memory/reindex", classification: "routine", responseType: "MemoryReindexResult" },

  // knowledge (knowledge) - Classified Exceptions
  { id: "knowledge.list", namespace: "knowledge", clientMethod: "list", method: "GET", path: "/knowledge", classification: "routine", responseType: "KnowledgeListResult" },
  { id: "knowledge.show", namespace: "knowledge", clientMethod: "show", method: "GET", path: "/knowledge/:id", classification: "exception", exceptionReason: "semantic-transform: 404 to found:false domain union" },
  { id: "knowledge.search", namespace: "knowledge", clientMethod: "search", method: "GET", path: "/knowledge/search", classification: "routine", responseType: "KnowledgeSearchResult" },
  { id: "knowledge.add", namespace: "knowledge", clientMethod: "add", method: "POST", path: "/knowledge", classification: "routine", responseType: "KnowledgeAddResult" },
  { id: "knowledge.delete", namespace: "knowledge", clientMethod: "delete", method: "DELETE", path: "/knowledge/:id", classification: "exception", exceptionReason: "semantic-transform: 404 to not_found domain union" },
  { id: "knowledge.reindex", namespace: "knowledge", clientMethod: "reindex", method: "POST", path: "/knowledge/reindex", classification: "routine", responseType: "KnowledgeReindexResult" },

  // history (history) - Classified Exceptions
  { id: "history.list", namespace: "history", clientMethod: "list", method: "GET", path: "/history", classification: "routine", responseType: "HistoryListResult" },
  { id: "history.listDiscoveredScopeRecords", namespace: "history", clientMethod: "listDiscoveredScopeRecords", method: "GET", path: "/history/discovered-scope-records", classification: "routine", responseType: "HistoryListResult" },
  { id: "history.show", namespace: "history", clientMethod: "show", method: "GET", path: "/history/:id", classification: "exception", exceptionReason: "semantic-transform: 404 to found:false domain union and detail decoding" },
  { id: "history.delete", namespace: "history", clientMethod: "delete", method: "DELETE", path: "/history/:id", classification: "exception", exceptionReason: "semantic-transform: 404 to not_found domain union" },
  { id: "history.search", namespace: "history", clientMethod: "search", method: "GET", path: "/api/history/search", classification: "routine", responseType: "HistorySearchResult" },
  { id: "history.reindex", namespace: "history", clientMethod: "reindex", method: "POST", path: "/history/reindex", classification: "routine", responseType: "HistoryReindexResult" },

  // ownerQuestions (owner-questions) - Classified Exceptions
  { id: "ownerQuestions.list", namespace: "ownerQuestions", clientMethod: "list", method: "GET", path: "/owner-questions", classification: "routine", responseType: "OwnerQuestionsListResult" },
  { id: "ownerQuestions.answer", namespace: "ownerQuestions", clientMethod: "answer", method: "POST", path: "/owner-questions/:id/answer", classification: "exception", exceptionReason: "semantic-transform: 404 to not_found domain union" },
  { id: "ownerQuestions.dismiss", namespace: "ownerQuestions", clientMethod: "dismiss", method: "POST", path: "/owner-questions/:id/dismiss", classification: "exception", exceptionReason: "semantic-transform: 404 to not_found domain union" },

  // ownerDecisions (owner-decisions) - Classified Exceptions
  { id: "ownerDecisions.list", namespace: "ownerDecisions", clientMethod: "list", method: "GET", path: "/owner-decisions", classification: "routine", responseType: "OwnerDecisionListResult" },
  { id: "ownerDecisions.show", namespace: "ownerDecisions", clientMethod: "show", method: "GET", path: "/owner-decisions/:id", classification: "exception", exceptionReason: "semantic-transform: 404 to found:false domain union" },
  { id: "ownerDecisions.answer", namespace: "ownerDecisions", clientMethod: "answer", method: "POST", path: "/owner-decisions/:id/answer", classification: "exception", exceptionReason: "semantic-transform: 404 to not_found domain union" },
  { id: "ownerDecisions.cancel", namespace: "ownerDecisions", clientMethod: "cancel", method: "POST", path: "/owner-decisions/:id/cancel", classification: "exception", exceptionReason: "semantic-transform: 404 to not_found domain union" },

  // harnessParity (harness-parity) - Classified Exceptions
  { id: "harnessParity.list", namespace: "harnessParity", clientMethod: "list", method: "GET", path: "/harness-parity/scenarios", classification: "routine", responseType: "HarnessParityListResult" },
  { id: "harnessParity.run", namespace: "harnessParity", clientMethod: "run", method: "POST", path: "/harness-parity/run", classification: "exception", exceptionReason: "semantic-transform: round-trips typed 400 response body discriminator { ok: false; reason; message }" },
  { id: "harnessParity.matrix", namespace: "harnessParity", clientMethod: "matrix", method: "POST", path: "/harness-parity/matrix", classification: "exception", exceptionReason: "semantic-transform: round-trips typed 400 response body discriminator { ok: false; reason; message }" },

  // config (config) - Classified Exceptions
  { id: "config.validate", namespace: "config", clientMethod: "validate", method: "GET", path: "/config/validate", classification: "routine", responseType: "ConfigValidateResult" },
  { id: "config.get", namespace: "config", clientMethod: "get", method: "GET", path: "/config/value", classification: "exception", exceptionReason: "semantic-transform: 404 to found:false domain union" },
  { id: "config.set", namespace: "config", clientMethod: "set", method: "PUT", path: "/config/value", classification: "exception", exceptionReason: "semantic-transform: authored error status decoding and link auth headers" },
  { id: "config.schemaPath", namespace: "config", clientMethod: "schemaPath", method: "GET", path: "/config/schema-path", classification: "routine", responseType: "{ path: string }" },
  { id: "config.schemaContent", namespace: "config", clientMethod: "schemaContent", method: "GET", path: "/config/schema", classification: "routine", responseType: "{ content: string }" },

  // voice (voice) - Classified Exceptions
  { id: "voice.transcribe", namespace: "voice", clientMethod: "transcribe", method: "POST", path: "/voice/transcribe", classification: "exception", exceptionReason: "protocol-limit: binary base64 audio transcoding and 400/502/503 provider error code translation" },
  { id: "voice.synthesize", namespace: "voice", clientMethod: "synthesize", method: "POST", path: "/voice/synthesize", classification: "exception", exceptionReason: "protocol-limit: binary base64 audio transcoding and 400/502/503 provider error code translation" },

  // web (web) - Classified Exceptions
  { id: "web.start", namespace: "web", clientMethod: "start", method: "POST", path: "/web/start", classification: "exception", exceptionReason: "protocol-limit: local-only daemon refusal returning { ok: false, reason: 'daemon_required' }" },

  // mcpServer (mcp-server) - Classified Exceptions
  { id: "mcpServer.start", namespace: "mcpServer", clientMethod: "start", method: "POST", path: "/mcp-server/start", classification: "exception", exceptionReason: "protocol-limit: local-only daemon refusal returning { ok: false, reason: 'daemon_required' }" },

  // workflow (workflow-ops) - Classified Exceptions
  { id: "workflow.listRuns", namespace: "workflow", clientMethod: "listRuns", method: "GET", path: "/workflow/runs", classification: "routine", responseType: "WorkflowRunsListResult" },
  { id: "workflow.listDeadLetters", namespace: "workflow", clientMethod: "listDeadLetters", method: "GET", path: "/workflow/dead-letters", classification: "routine", responseType: "WorkflowDeadLetterListResult" },
  { id: "workflow.getDeadLetter", namespace: "workflow", clientMethod: "getDeadLetter", method: "GET", path: "/workflow/dead-letters/:id", classification: "exception", exceptionReason: "semantic-transform: 404 to found:false domain union" },
  { id: "workflow.dismissDeadLetter", namespace: "workflow", clientMethod: "dismissDeadLetter", method: "POST", path: "/workflow/dead-letters/:id/dismiss", classification: "exception", exceptionReason: "semantic-transform: 404/400 error status mapping" },
  { id: "workflow.redriveDeadLetter", namespace: "workflow", clientMethod: "redriveDeadLetter", method: "POST", path: "/workflow/dead-letters/:id/redrive", classification: "exception", exceptionReason: "semantic-transform: 404/400 error status mapping" },
  { id: "workflow.exportDeadLetterDiagnostics", namespace: "workflow", clientMethod: "exportDeadLetterDiagnostics", method: "GET", path: "/workflow/dead-letters/:id/export", classification: "exception", exceptionReason: "semantic-transform: nullable diagnostics export parsing" },
  { id: "workflow.status", namespace: "workflow", clientMethod: "status", method: "GET", path: "/workflow/status", classification: "exception", exceptionReason: "semantic-transform: pendingAbort augmentation from local signal files" },
  { id: "workflow.getRun", namespace: "workflow", clientMethod: "getRun", method: "GET", path: "/workflow/runs/:id", classification: "exception", exceptionReason: "semantic-transform: 404 to found:false domain union" },
  { id: "workflow.listDefinitions", namespace: "workflow", clientMethod: "listDefinitions", method: "GET", path: "/workflow/definitions", classification: "routine", responseType: "WorkflowDefinitionsResult" },
  { id: "workflow.pause", namespace: "workflow", clientMethod: "pause", method: "POST", path: "/workflow/pause", classification: "routine", responseType: "WorkflowPauseResult" },
  { id: "workflow.resume", namespace: "workflow", clientMethod: "resume", method: "POST", path: "/workflow/resume", classification: "routine", responseType: "WorkflowResumeResult" },
  { id: "workflow.abort", namespace: "workflow", clientMethod: "abort", method: "POST", path: "/workflow/abort", classification: "routine", responseType: "WorkflowAbortResult" },
  { id: "workflow.reload", namespace: "workflow", clientMethod: "reload", method: "POST", path: "/workflow/reload", classification: "routine", responseType: "WorkflowReloadResult" },
  { id: "workflow.triggerByName", namespace: "workflow", clientMethod: "triggerByName", method: "POST", path: "/workflow/trigger", classification: "exception", exceptionReason: "semantic-transform: 409 already_queued and unknown_workflow error mapping" },
  { id: "workflow.trial", namespace: "workflow", clientMethod: "trial", method: "POST", path: "/workflow/trial", classification: "exception", exceptionReason: "semantic-transform: 400/404/409 validation and trial conflict mapping" },
  { id: "workflow.explain", namespace: "workflow", clientMethod: "explain", method: "GET", path: "/workflow/explain", classification: "routine", responseType: "AutomationExplainResult" },
  { id: "workflow.simulate", namespace: "workflow", clientMethod: "simulate", method: "POST", path: "/workflow/simulate", classification: "routine", responseType: "WorkflowSimulationResult" },
  { id: "workflow.enable", namespace: "workflow", clientMethod: "enable", method: "POST", path: "/workflow/definitions/:name/enable", classification: "exception", exceptionReason: "semantic-transform: 404 not_found error mapping" },
  { id: "workflow.disable", namespace: "workflow", clientMethod: "disable", method: "POST", path: "/workflow/definitions/:name/disable", classification: "exception", exceptionReason: "semantic-transform: 404 not_found error mapping" },
  { id: "workflow.cancelRun", namespace: "workflow", clientMethod: "cancelRun", method: "POST", path: "/workflow/runs/:id/cancel", classification: "exception", exceptionReason: "semantic-transform: 404/409 active/sandbox_preserved status code mapping" },
  { id: "workflow.abortRun", namespace: "workflow", clientMethod: "abortRun", method: "POST", path: "/workflow/runs/:id/abort", classification: "exception", exceptionReason: "semantic-transform: 404/409 queued status code mapping" },

  // daemonOps, sessions, scopes, ui (daemon-ops) - Classified Exceptions
  { id: "daemonOps.status", namespace: "daemonOps", clientMethod: "status", method: "GET", path: "/status", classification: "exception", exceptionReason: "semantic-transform: state wrapper mapping live status to DaemonOpsStatusResult" },
  { id: "daemonOps.pid", namespace: "daemonOps", clientMethod: "pid", method: "GET", path: "/status", classification: "exception", exceptionReason: "semantic-transform: pid extraction from status" },
  { id: "daemonOps.stop", namespace: "daemonOps", clientMethod: "stop", method: "POST", path: "/status", classification: "exception", exceptionReason: "protocol-limit: local process PID signaling and stop attempt recording" },
  { id: "daemonOps.reload", namespace: "daemonOps", clientMethod: "reload", method: "POST", path: "/reload", classification: "routine", responseType: "DaemonOpsReloadResult" },
  { id: "sessions.list", namespace: "sessions", clientMethod: "list", method: "GET", path: "/sessions", classification: "routine", responseType: "SessionsListResult" },
  { id: "sessions.setAutonomyMode", namespace: "sessions", clientMethod: "setAutonomyMode", method: "PATCH", path: "/sessions/:id", classification: "exception", exceptionReason: "semantic-transform: 404 not_found mapping and autonomy mode wire translation" },
  { id: "scopes.list", namespace: "scopes", clientMethod: "list", method: "GET", path: "/scopes", classification: "routine", responseType: "ScopesListResult" },
  { id: "scopes.use", namespace: "scopes", clientMethod: "use", method: "PATCH", path: "/scopes/active", classification: "exception", exceptionReason: "semantic-transform: 404 not_found mapping and active scope projection" },
  { id: "scopes.inspectAuthority", namespace: "scopes", clientMethod: "inspectAuthority", method: "GET", path: "/scopes/:scopeId/authority", classification: "exception", exceptionReason: "semantic-transform: non-ok body parsing into ScopeAuthorityFailure" },
  { id: "scopes.validateAuthority", namespace: "scopes", clientMethod: "validateAuthority", method: "POST", path: "/scopes/:scopeId/authority/validate", classification: "routine", responseType: "ScopeAuthorityValidationResult" },
  { id: "scopes.applyAuthority", namespace: "scopes", clientMethod: "applyAuthority", method: "PUT", path: "/scopes/:scopeId/authority", classification: "exception", exceptionReason: "security: interactive client challenge-response header negotiation and mutual signing" },
  { id: "ui.listSurfaces", namespace: "ui", clientMethod: "listSurfaces", method: "GET", path: "/ui/surfaces", classification: "routine", responseType: "UiSurfaceBundle" },
  { id: "ui.executeAction", namespace: "ui", clientMethod: "executeAction", method: "POST", path: "/ui/actions/execute", classification: "exception", exceptionReason: "semantic-transform: bundle resolution and client namespace / route execution dispatching" },
  { id: "ui.watchEvents", namespace: "ui", clientMethod: "watchEvents", method: "GET", path: "/events", classification: "exception", exceptionReason: "streaming: SSE event stream AsyncIterable generator" },

  // evalHarness (eval-harness) - Classified Exceptions
  { id: "evalHarness.list", namespace: "evalHarness", clientMethod: "list", method: "GET", path: "/eval/list", classification: "routine", responseType: "EvalListResult" },
  { id: "evalHarness.run", namespace: "evalHarness", clientMethod: "run", method: "POST", path: "/api/eval/run", classification: "exception", exceptionReason: "protocol-limit: long execution timeout (EVAL_RUN_DAEMON_TIMEOUT_MS = 600_000)" },
  { id: "evalHarness.runAgyModels", namespace: "evalHarness", clientMethod: "runAgyModels", method: "POST", path: "/api/eval/agy-models", classification: "exception", exceptionReason: "protocol-limit: long execution timeout (EVAL_RUN_DAEMON_TIMEOUT_MS = 600_000)" },
  { id: "evalHarness.calibration", namespace: "evalHarness", clientMethod: "calibration", method: "GET", path: "/eval/calibration", classification: "routine", responseType: "EvalCalibrationResult" },

  // setup (setup) - Classified Exceptions
  { id: "setup.list", namespace: "setup", clientMethod: "list", method: "GET", path: "/setup/requirements", classification: "routine", responseType: "ModuleSetupStatusResponse" },
  { id: "setup.submitForm", namespace: "setup", clientMethod: "submitForm", method: "POST", path: "/setup/requirements/:moduleName/:requirementId/form", classification: "exception", exceptionReason: "security: unscoped validation guard and setup mutation error extraction" },
  { id: "setup.storeSecret", namespace: "setup", clientMethod: "storeSecret", method: "POST", path: "/setup/requirements/:moduleName/:requirementId/secret", classification: "exception", exceptionReason: "security: unscoped validation guard and setup mutation error extraction" },
  { id: "setup.start", namespace: "setup", clientMethod: "start", method: "POST", path: "/setup/requirements/:moduleName/:requirementId/start", classification: "exception", exceptionReason: "security: unscoped validation guard and setup mutation error extraction" },
  { id: "setup.complete", namespace: "setup", clientMethod: "complete", method: "POST", path: "/setup/actions/:actionId/complete", classification: "exception", exceptionReason: "security: unscoped validation guard and setup mutation error extraction" },
  { id: "setup.refresh", namespace: "setup", clientMethod: "refresh", method: "POST", path: "/setup/requirements/:moduleName/:requirementId/refresh", classification: "exception", exceptionReason: "security: unscoped validation guard and setup mutation error extraction" },
  { id: "setup.revoke", namespace: "setup", clientMethod: "revoke", method: "DELETE", path: "/setup/requirements/:moduleName/:requirementId", classification: "exception", exceptionReason: "security: unscoped validation guard and setup mutation error extraction" },
];
