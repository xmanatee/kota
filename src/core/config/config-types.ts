import type { AgentTokenBudgetConfig } from "#core/agent-harness/token-budget.js";
import type { QuietHoursConfig } from "#core/daemon/notification-gate.js";
import type { ScopeAuthorityMetadata } from "#core/daemon/scope-authority-types.js";
import type { ScopePolicyFragment } from "#core/daemon/scope-policy.js";
import type { ModelTiers } from "#core/model/model-router.js";
import type { ModelOutputTokenLimits } from "#core/model/output-token-limits.js";
import type { ForeignModuleConfig } from "#core/modules/foreign-module.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { GuardrailsConfig } from "#core/tools/guardrails.js";
import type { KotaModuleConfigRegistry } from "./config-slice.js";

type ConfigOpaque = unknown;

export type CoreKotaConfig = {
  model?: string;
  editorModel?: string;
  maxTokens?: number;
  thinking?: boolean;
  thinkingBudget?: number;
  verbose?: boolean;
  skipConfirmations?: boolean;

  /**
   * Operator-owned scope trust list. Only persisted global config can grant
   * trust to a target scope's `.kota/config.json`; scope config and caller
   * overrides cannot provide machine authority.
   * Entries must be absolute paths, with `~/` accepted for the operator home.
   */
  trustedScopes?: string[];

  /** Machine-owned scope policies, mutated through the daemon authority service. */
  scopePolicies?: ScopePolicyFragment[];

  /** Revision and operator audit trail for trust/policy transactions. */
  scopeAuthority?: ScopeAuthorityMetadata;

  /** Tool groups to auto-enable at session start (e.g. ["web", "code"]). */
  autoEnable?: string[];

  /** User profile — injected into system prompt for personalization. */
  user?: {
    name?: string;
    context?: string;
  };

  /** Prompt aliases — keys that expand into prefix text when starting a message. */
  aliases?: Record<string, string>;

  /** Self-reflection — evaluate response quality before delivering. Default: true. */
  reflection?: boolean;

  /** Guardrails — risk classification and policy enforcement for tool calls. */
  guardrails?: GuardrailsConfig;

  /** Per-module configuration. Keys are module names, values are module-specific settings. */
  modules?: Record<string, Record<string, ConfigOpaque>>;

  /** Foreign-language (out-of-process) modules. */
  foreignModules?: ForeignModuleConfig[];

  /** Provider overrides. Keys are service types (e.g. "memory"), values are provider names. */
  providers?: Record<string, string>;

  /** Model tier mapping for adaptive routing. Keys: fast, balanced, capable. */
  modelTiers?: ModelTiers;

  /**
   * Explicit output-token request budgets for operator-provided model ids.
   * Shipped preset model ids resolve through the core model resolver; entries
   * here intentionally override that resolver or cover custom model ids.
   */
  modelOutputTokenLimits?: ModelOutputTokenLimits;

  /** Per-agent model overrides. */
  agentModels?: Record<string, string>;

  /**
   * Default agent harness adapter name. Must match a harness registered by a
   * loaded module. No implicit default — KOTA does not silently pick one.
   *
   * Operators that ship a preset rarely need to set this directly: the active
   * preset (`defaultPreset` / `--preset` / `KOTA_PRESET`) carries its own
   * harness. This field stays for the rare case where a workflow or operator
   * needs to pin a harness independently of the preset's harness.
   */
  defaultAgentHarness?: string;

  /**
   * Default preset id for this scope. Selects harness + default model +
   * fast/balanced/capable tier mapping + default reasoning effort + auth
   * contract together. Resolution priority: `--preset` flag > `KOTA_PRESET`
   * env > this field > shipped default preset. Must match a shipped preset
   * id (`claude` | `codex` | `gemini` | `gemini-cli` |
   * `antigravity-cli`). When unset, KOTA selects the shipped default preset
   * (`codex`).
   */
  defaultPreset?: string;

  /** TTL override for pending approval items in milliseconds. Defaults to evidence policy. */
  approvalTtlMs?: number;

  /** Run artifact retention policy for `.kota/runs/`. */
  runsGc?: {
    /** Delete runs older than this many days. Defaults to evidence policy. */
    retentionDays?: number;
    /** Always keep at least this many recent runs per workflow (default: 10). */
    minKeepPerWorkflow?: number;
  };

  /** HTTP server settings for `kota serve`. */
  serve?: {
    /** Disable bearer-token auth (default: auth enabled). For localhost-only dev use. */
    noAuth?: boolean;
    /** Show per-turn cost line in terminal output (default: true). */
    showCost?: boolean;
    /** Autonomy mode applied to new interactive sessions when the client does not specify one. */
    defaultAutonomyMode?: AutonomyMode;
  };

  /** CLI entrypoint settings (interactive REPL, `history resume`, piped input). */
  cli?: {
    /** Autonomy mode applied to CLI-launched sessions when no per-invocation override is provided. */
    defaultAutonomyMode?: AutonomyMode;
  };

  /** Log output settings. */
  log?: {
    /** "text" is human-readable (default); "json" emits newline-delimited JSON. */
    format?: "text" | "json";
  };

  /** Daemon lifecycle settings. */
  daemon?: {
    /** ms to wait for active workflow runs before aborting on shutdown. 0 = drain. */
    shutdownGracePeriodMs?: number;
    /** Recent SSE events retained in the in-memory ring buffer. Default: 500. */
    eventBufferSize?: number;
    /** Idle TTL for daemon-owned interactive chat sessions. Default: 5 min. */
    sessionIdleTtlMs?: number;
  };

  /** Notification settings. */
  notifications?: {
    /** Minimum ms between failure alerts for the same workflow. Default: 0. */
    alertCooldownMs?: number;
    /** Suppress non-critical channel notifications outside specified hours. */
    quietHours?: QuietHoursConfig;
  };

  /** Foreign module health monitoring settings. */
  moduleMonitoring?: {
    /** Restarts within `crashAlertWindowMs` that trigger `module.crash.alert`. */
    crashAlertThreshold?: number;
    /** Rolling window for counting module restarts. Also alert cooldown. */
    crashAlertWindowMs?: number;
  };

  /** Workflow runtime settings. */
  workflow?: {
    /** Max step output bytes before truncation. Default: 256 KB. Hard cap: 10 MB. */
    maxStepOutputBytes?: number;
    /**
     * Optional default max total-token budget applied to workflow agent steps
     * that do not declare their own tokenBudget.
     */
    agentTokenBudget?: AgentTokenBudgetConfig;
  };
};

export type ModuleConfigSliceFields = {
  [K in keyof KotaModuleConfigRegistry]?: KotaModuleConfigRegistry[K];
};

export type KotaConfig = CoreKotaConfig & ModuleConfigSliceFields;
