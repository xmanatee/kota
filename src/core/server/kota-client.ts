/**
 * KotaClient — the typed contract every CLI subcommand consumes for
 * daemon-or-local access to KOTA capabilities.
 *
 * The contract is the single public surface CLI code imports. Two
 * implementors realize it:
 *
 * - `DaemonControlClient` (HTTP) — talks to a running daemon over
 *   `127.0.0.1` using the bearer token published in
 *   `.kota/daemon-control.json`.
 * - `LocalKotaClient` (in-process) — talks directly to the local stores
 *   and providers when no daemon is reachable.
 *
 * A single `resolveKotaClient` selector picks one implementor at CLI
 * startup. Subcommands consume `ctx.client.<namespace>.<method>` and
 * never re-decide that policy themselves.
 *
 * New capabilities are added as namespaces. Each namespace is a typed
 * sub-interface with the operations the CLI needs. Module-owned local
 * implementations are registered through ModuleContext and assembled
 * into the `LocalKotaClient` by the selector.
 */
// Per-namespace client interfaces are owned by their module. The aggregate
// imports them back to compose the contract — this is the only sanctioned
// `#modules/*` import direction in `src/core/server/`. The narrow exception
// is enforced in `src/core/agent-harness/no-module-imports-in-core.test.ts`.
import type { AgentsClient } from "#modules/agent-ops/client.js";
import type { AnswerClient } from "#modules/answer/client.js";
import type { ApprovalsClient } from "#modules/approval-queue/client.js";
import type { CaptureClient } from "#modules/capture/client.js";
import type { ConfigClient } from "#modules/config/client.js";
import type {
  DaemonOpsClient,
  ProjectsClient,
  SessionsClient,
} from "#modules/daemon-ops/client.js";
import type { DoctorClient } from "#modules/doctor/client.js";
import type { EvalHarnessClient } from "#modules/eval-harness/client.js";
import type { AuditClient } from "#modules/guardrails-audit/client.js";
import type { HarnessParityClient } from "#modules/harness-parity/client.js";
import type { HistoryClient } from "#modules/history/client.js";
import type { KnowledgeClient } from "#modules/knowledge/client.js";
import type { McpServerClient } from "#modules/mcp-server/client.js";
import type { MemoryClient } from "#modules/memory/client.js";
import type {
  ModulesAdminClient,
  ModulesClient,
} from "#modules/module-manager/client.js";
import type { OwnerDecisionsClient } from "#modules/owner-decisions/client.js";
import type { OwnerQuestionsClient } from "#modules/owner-questions/client.js";
import type { RecallClient } from "#modules/recall/client.js";
import type { RepoTasksClient } from "#modules/repo-tasks/client.js";
import type { RetractClient } from "#modules/retract/client.js";
import type { SecretsClient } from "#modules/secrets/client.js";
import type { SetupClient } from "#modules/setup/client.js";
import type { SkillsClient } from "#modules/skill-ops/client.js";
import type { VoiceClient } from "#modules/voice/client.js";
import type { WebClient } from "#modules/web/client.js";
import type { WebhookClient } from "#modules/webhook/client.js";
import type { WorkflowClient } from "#modules/workflow-ops/client.js";

/**
 * The single typed surface CLI code imports for daemon-or-local access.
 *
 * The contract grows by adding namespaces here, delegating in
 * `DaemonControlClient` to existing or new HTTP routes, and exposing
 * matching local handlers from the owning module's top-level
 * `localClient(ctx)` factory.
 */
export interface KotaClient {
  forProject(projectId: string): KotaClient;
  readonly workflow: WorkflowClient;
  readonly approvals: ApprovalsClient;
  readonly secrets: SecretsClient;
  readonly tasks: RepoTasksClient;
  readonly memory: MemoryClient;
  readonly ownerDecisions: OwnerDecisionsClient;
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
  readonly projects: ProjectsClient;
  readonly doctor: DoctorClient;
  readonly evalHarness: EvalHarnessClient;
  readonly recall: RecallClient;
  readonly answer: AnswerClient;
  readonly capture: CaptureClient;
  readonly retract: RetractClient;
  readonly setup: SetupClient;
}

/**
 * Names of every namespace on `KotaClient`. Local handler registration
 * is keyed by these names; the selector validates that every namespace
 * is wired before constructing a `LocalKotaClient`.
 */
export const KOTA_CLIENT_NAMESPACES = [
  "workflow",
  "approvals",
  "secrets",
  "tasks",
  "memory",
  "ownerDecisions",
  "ownerQuestions",
  "history",
  "knowledge",
  "sessions",
  "modules",
  "agents",
  "skills",
  "harnessParity",
  "webhook",
  "voice",
  "web",
  "mcpServer",
  "audit",
  "config",
  "modulesAdmin",
  "daemonOps",
  "projects",
  "doctor",
  "evalHarness",
  "recall",
  "answer",
  "capture",
  "retract",
  "setup",
] as const satisfies ReadonlyArray<keyof KotaClient>;

export type KotaClientNamespace = (typeof KOTA_CLIENT_NAMESPACES)[number];

/** Local-side handler bundle: one namespace impl per declared capability. */
export type LocalClientHandlers = {
  [K in KotaClientNamespace]: KotaClient[K];
};

/**
 * Daemon-side handler bundle: one namespace impl per declared capability.
 *
 * Symmetric to `LocalClientHandlers`. `DaemonControlClient` is built by
 * assembling a `DaemonClientHandlers` map from a core-side stub plus any
 * module that contributes a `daemonClient(link)` factory on its
 * `KotaModule`. The selector validates full coverage and rejects partially
 * wired clients.
 */
export type DaemonClientHandlers = {
  [K in KotaClientNamespace]: KotaClient[K];
};

/**
 * Typed client-side rejection for project-scoped calls that name a project
 * outside the daemon/project registry. `forProject(projectId)` normalizes the
 * module route errors into this shape so callers can branch on `reason`
 * instead of parsing error text.
 */
export class KotaClientProjectError extends Error {
  readonly reason = "unknown_project" as const;
  readonly projectId: string;

  constructor(projectId: string, cause?: Error) {
    super(`Unknown project: ${projectId}`, cause ? { cause } : undefined);
    this.name = "KotaClientProjectError";
    this.projectId = projectId;
  }
}
