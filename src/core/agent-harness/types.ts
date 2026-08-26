import type { AgentWriteScope } from "#core/agents/agent-types.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type {
  ResolvedScopePolicy,
  ScopePolicyAuthority,
  ScopePolicySnapshotAccessor,
} from "#core/daemon/scope-policy.js";
import type { ProcessIdentity } from "#core/execution/process-supervisor.js";
import type { ModelProviderSelection } from "#core/model/model-client.js";
import type { ModelOutputTokenLimits } from "#core/model/output-token-limits.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { GuardrailsConfig } from "#core/tools/guardrails.js";
import type { ToolApprovalResolver } from "#core/tools/tool-approval.js";
import type { KotaAgentMessage } from "./agent-message.js";
import type {
  AgentAskOwnerOptions,
  AgentCanUseTool,
  AgentMcpServers,
} from "./run-option-types.js";
import type { AgentTokenBudgetLedger } from "./token-budget.js";
import type { AgentUsage } from "./usage.js";

export type { KotaAgentMessage } from "./agent-message.js";
export type { AgentHarness } from "./harness-definition.js";
export type {
  AgentAskOwnerOptions,
  AgentCanUseTool,
  AgentCanUseToolContext,
  AgentDecisionAttribution,
  AgentMcpHttpServerConfig,
  AgentMcpServerConfig,
  AgentMcpServers,
  AgentMcpSseServerConfig,
  AgentMcpStdioServerConfig,
  AgentPermissionResult,
} from "./run-option-types.js";

import type { AgentHarnessSessionContext } from "./session-context.js";

/**
 * KOTA-native portable system-prompt text every harness-neutral caller
 * delivers. Adapters that wrap prompts in a native envelope (e.g. the
 * claude-agent-sdk `claude_code` preset) do the wrapping inside the adapter;
 * the protocol surface is a plain string.
 */
export type AgentSystemPrompt = string;

/**
 * KOTA's portable agent-effort enum. Adapters map these literals onto their
 * provider's native reasoning/effort wire shape (see
 * `src/modules/model-clients/reasoning.ts`). Five literals, ordered low-to-max.
 */
export type AgentEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type AgentHarnessWriter = { write(text: string): boolean };
export type AgentHarnessAbortQuarantine = {
  /**
   * Register the run-local stop barrier before a native harness can perform
   * an action. The handler must stop the native execution and resolve only
   * after it can no longer mutate the workspace or external systems.
   */
  register(handler: (reason: Error) => void | Promise<void>): void;
};
export type AgentHarnessWorkflowContext = {
  workflowName: string;
  runId: string;
  stepId: string;
  spanId: string;
  scopeId: string;
  projectId: string;
};

/**
 * Per-step adapter-private fragment validated by `AgentHarness.validateStepOptions`.
 * The neutral protocol carries this as opaque `unknown` — only the resolved
 * adapter knows its real shape. The executor passes the validated value
 * verbatim through `AgentHarnessRunOptions.harnessOverrides`.
 */
export type AgentHarnessStepOverrides = unknown;

/** JSON Schema object whose extension-key values remain opaque to core. */
export type AgentOutputSchemaValue = unknown;
export type AgentOutputSchema = Record<string, AgentOutputSchemaValue>;

/**
 * Neutral, KOTA-native run options every adapter consumes.
 *
 * Every field on this type is either a KOTA concept (autonomy mode, tools,
 * effort, prompt, owner-questions, abort, MCP transport variants) or a
 * harness-agnostic transport knob (cwd, model name, max turns, system
 * prompt). Provider-specific knobs (claude SDK permission/setting fields,
 * future Codex CLI flags, …) must travel inside `harnessOverrides` and be
 * validated by the resolved adapter's `validateStepOptions`.
 */
export type AgentHarnessRunOptions = {
  prompt: string;
  model?: string;
  /**
   * KOTA-owned structured-output contract. Adapters may enforce it through a
   * native provider surface; workflow execution still validates the result.
   */
  outputSchema?: AgentOutputSchema;
  /**
   * Shared ModelClient provider selection for adapters that execute through
   * `createModelClient`. This is KOTA's own model routing surface, not a
   * provider-native wire shape; adapters that use native CLIs ignore it.
   */
  modelProvider?: ModelProviderSelection;
  /**
   * Operator-provided output-token request budgets keyed by model id. Shipped
   * preset model ids resolve through core; this map covers custom ids or
   * intentional overrides for KOTA-native ModelClient harnesses.
   */
  modelOutputTokenLimits?: ModelOutputTokenLimits;
  /** Canonical directory root of the selected directory-backed scope. */
  projectDir?: string;
  /** Execution working directory, which may be an isolated worktree. */
  cwd?: string;
  /**
   * Agent-owned local filesystem mutation boundary, relative to `cwd`.
   * Direct-filesystem adapters must project this into their sandbox; hosted
   * tool loops pass it to the shared permissioned tool runner.
   */
  agentWriteScope?: AgentWriteScope;
  /**
   * Runtime-owned per-run directory where a workflow agent may write evidence
   * and finish-protocol artifacts. This is enforced as a separate exception
   * to `agentWriteScope`; sibling workflow state remains inaccessible.
   */
  agentOutputDir?: string;
  /**
   * Per-run subprocess environment additions. Callers use this for isolated
   * runtime resources such as temp roots and port ranges; adapters must merge
   * these into the spawned process environment or declare the option
   * unsupported.
   */
  env?: Record<string, string>;
  /** Machine-owned config path excluded from every agent execution sandbox. */
  authorityConfigPath?: string;
  verbose?: boolean;
  systemPrompt?: AgentSystemPrompt;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: AgentMcpServers;
  /**
   * Controls automatic discovery of project-local MCP declarations. Adapters
   * that do not discover project MCP config are unaffected. Internal agent
   * launches against mutable worktrees set this to `"disabled"` so ignored
   * config cannot create a subprocess before tool authorization runs.
   */
  mcpProjectConfigPolicy?: "enabled" | "disabled";
  /**
   * KOTA-native session supervision posture. The adapter maps this onto its
   * provider's native permission or KOTA-owned tool-runner gate. Adapters
   * without a permission UX must still honor the mode or reject it loudly
   * through their unsupported-option boundary.
   *
   * Callers that do not care about supervision posture omit this field;
   * adapters default to `"autonomous"`. Workflow agent steps always set it
   * explicitly because the workflow validator requires
   * `WorkflowAgentStep.autonomyMode`.
   */
  autonomyMode?: AutonomyMode;
  persistSession?: boolean;
  resumeSessionId?: string;
  /**
   * Session/scope identity routed only to KOTA-owned tool execution. The
   * harness runner creates an invocation-local identity when callers do not
   * own a longer-lived interactive session.
   */
  sessionContext?: AgentHarnessSessionContext;
  workflowContext?: AgentHarnessWorkflowContext;
  /**
   * Shared per-run token budget ledger. KOTA-controlled loops must check this
   * before each model turn and debit usage after the provider returns it.
   * Native adapters that only expose aggregate usage debit at the wrapper
   * boundary and record a non-enforcing diagnostic.
   */
  tokenBudget?: AgentTokenBudgetLedger;
  effort: AgentEffort;
  abortController?: AbortController;
  /**
   * Called immediately after a native adapter has spawned and identified its
   * isolated process group. Runtime owners use this to durably fence recovery
   * before the child can perform meaningful work.
   */
  onProcessSpawn?: (identity: ProcessIdentity) => void;
  /**
   * Run-local cancellation control installed by `runAgentHarness` for native
   * tool loops. Callers do not provide this field; a native adapter declaring
   * `nativeAbortQuarantine: "confirmed-stop"` must register its stop barrier
   * synchronously when the execution starts.
   */
  abortQuarantine?: AgentHarnessAbortQuarantine;
  enableFileCheckpointing?: boolean;
  onMessage?: (message: KotaAgentMessage) => void | Promise<void>;
  onUsage?: (usage: AgentUsage) => void;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  canUseTool?: AgentCanUseTool;
  /**
   * KOTA-owned tool-runner context for adapters that execute tools in-process.
   * Native CLI adapters do not consume these fields because they do not host the
   * shared KOTA tool runner.
   */
  guardrailsConfig?: GuardrailsConfig;
  /** Policy resolved when the harness run starts, used for discovery and native setup. */
  scopePolicy?: ResolvedScopePolicy;
  /**
   * Live authority routed only into KOTA-owned tool execution so nested native
   * launches can subscribe to restrictive revisions. Native adapters do not
   * receive this object.
   */
  scopePolicyAuthority?: ScopePolicyAuthority;
  /**
   * Current machine-owned authority for KOTA-hosted tool authorization. Hosted
   * loops call this immediately before every invocation instead of retaining
   * the run-start policy snapshot.
   */
  getScopePolicySnapshot?: ScopePolicySnapshotAccessor;
  clientApprovalResolver?: ToolApprovalResolver;
	approvalQueue?: ApprovalQueue;
  idempotencyStore?: IdempotencyStore;
  /**
   * Harness-neutral request to expose the owner-questions escalation tool to
   * the agent. Adapters that can host a tool loop honor it using their native
   * mechanism (MCP server, direct registry call). `runAgentHarness` rejects
   * requests against adapters whose `askOwnerToolName` is `null`.
   */
  askOwner?: AgentAskOwnerOptions;
  /**
   * Adapter-private per-step overrides validated by the resolved adapter's
   * `validateStepOptions`. The value is opaque to core; the adapter knows its
   * shape. Core never reads or mutates this field.
   */
  harnessOverrides?: AgentHarnessStepOverrides;
};

export type AgentHarnessResult = {
  text: string;
  streamedText: string;
  sessionId?: string;
  turns: number;
  usage: AgentUsage;
  subtype?: string;
  isError: boolean;
};
