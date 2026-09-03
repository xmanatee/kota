import { ALL_HARNESS_HOOK_KINDS, type HarnessHookKind } from "./hooks.js";
import type { ReadWeeklyQuota } from "./quota.js";
import {
  AGENT_HARNESS_UNSUPPORTED_RUN_OPTION_KEYS,
  type AgentHarnessReadinessProbe,
  type AgentHarnessUnsupportedOption,
} from "./readiness-types.js";
import type {
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessStepOverrides,
  AgentHarnessWriter,
} from "./types.js";

/**
 * An agent harness is the long-lived loop that turns a prompt plus options
 * into a completed agent run. Different adapters implement this protocol
 * against different runtimes (Claude Agent SDK, thin ModelClient loop, codex
 * agent SDK, etc.). The session/step/delegate layer always calls the protocol
 * and never the underlying runtime directly.
 */
export type AgentHarness = {
  /** Optional account-level subscription quota capability; never runs an agent. */
  readonly readWeeklyQuota?: ReadWeeklyQuota;
  /** Unique harness name, used to resolve adapters at runtime. */
  readonly name: string;
  /** Short human-facing description of what this harness runs. */
  readonly description: string;
  /**
   * Whether this adapter can sustain a multi-turn interactive conversation.
   * The interactive REPL composes a transcript across turns and delivers it
   * through `run()`, so any adapter whose `run()` honors a textual prompt
   * plus prior-turn context can set this to `true`. Adapters that are
   * fundamentally single-shot (e.g. fire-and-forget webhook runners) set
   * this to `false` — the REPL entry point refuses to launch them.
   */
  readonly supportsMultiTurn: boolean;
  /**
   * Harness-boundary lifecycle hook kinds this adapter honors. The neutral
   * entry point (`runAgentHarness`) dispatches every registered hook of a
   * supported kind around this adapter's `run()`. If a module registers a
   * hook whose kind is not in this list, the entry point throws before
   * invoking `run()` — analogous to how `thin-agent-harness` rejects tool
   * options it cannot host.
   */
  readonly supportedHookKinds: readonly HarnessHookKind[];
  /**
   * The runtime tool name the agent will see in its catalog when
   * `AgentHarnessRunOptions.askOwner` is set. `null` means this adapter
   * cannot host the owner-questions surface; `runAgentHarness` rejects any
   * run that asks for it against such an adapter. Callers that construct an
   * agent prompt use this field to reference the correct tool name across
   * harnesses (e.g. `mcp__kota_owner_questions__ask_owner` on claude,
   * `ask_owner` on openai-tools).
   */
  readonly askOwnerToolName: string | null;
  /**
   * Whether this adapter emits `KotaAgentMessage` frames to an `onMessage`
   * callback. Adapters that do set this to `true`; adapters without a
   * streaming surface reject `onMessage` at the boundary. Callers consult
   * this flag to decide whether to subscribe — branching on a declared
   * capability rather than the adapter name.
   */
  readonly emitsAgentMessageStream: boolean;
  /**
   * Which runtime owns tool access for this harness. `kota` means callers can
   * route neutral tool-control options (`allowedTools`, `disallowedTools`,
   * `canUseTool`) through the adapter. `native` means the adapter's own CLI
   * process owns the tool loop and rejects KOTA-only controls.
   */
  readonly toolControl: "kota" | "native";
  /**
   * Declares that a native tool-loop adapter can stop its run and confirm
   * termination after cancellation. Native runs with an AbortController are
   * rejected before launch unless this is declared, and the adapter must then
   * register a run-local barrier through `abortQuarantine`.
   *
   * KOTA-controlled adapters omit this because hosted tool calls reauthorize
   * through KOTA and observe the run's AbortSignal directly.
   */
  readonly nativeAbortQuarantine?: "confirmed-stop";
  /**
   * Local readiness probe for operator-facing preflight surfaces. Adapters
   * own runtime details (native CLI, SDK package), harness-managed local
   * auth checks, unsupported neutral options, and any dynamic model/effort
   * catalog they alone can verify. Preset consumers add preset id, model
   * tiers, and env-auth state; workflow consumers pass their exact resolved
   * model and effort before launch.
   */
  readonly readiness?: AgentHarnessReadinessProbe;
  /**
   * Resolve non-secret environment locators needed to preserve a
   * harness-managed login when a trusted host runner replaces `HOME`.
   *
   * Adapters must return locator variables only (for example `CODEX_HOME`),
   * never tokens or other credential values. Environment-authenticated
   * harnesses use their preset's `authEnv` contract instead.
   */
  readonly resolveIsolatedHostAuthEnv?: (
    env: NodeJS.ProcessEnv,
  ) => Readonly<Record<string, string>>;
  /**
   * Static declaration of neutral run options this adapter cannot honor.
   * `runAgentHarness` checks these before hooks or adapter spawn so a caller
   * that depends on KOTA guardrails cannot accidentally fall through to a
   * prompt-only native runtime. Readiness reports should expose the same
   * entries for operator-facing preflight output.
   */
  readonly unsupportedRunOptions?: readonly AgentHarnessUnsupportedOption[];
  /**
   * Validates a per-step harness-specific options block and returns the
   * adapter-private fragment to thread through as
   * `AgentHarnessRunOptions.harnessOverrides`. The returned value is also
   * stored on the validated workflow step (under the step's
   * `harnessOptions[harness.name]` slot) for history and recovery.
   *
   * Declared only on harnesses that accept per-step options. Throws on
   * malformed input with a field-path message; the core step validator
   * catches the throw and wraps it with step-label context before surfacing
   * the `WorkflowDefinitionError`. Returning `undefined` is the supported
   * "no per-step overrides" signal — e.g. the caller supplied `{}` and the
   * harness treats empty as no-op.
   *
   * Only fields that are safe to serialize and safe to re-apply on a replay
   * should appear in the returned fragment; runtime-only fields such as
   * `abortController` or `canUseTool` must not be produced here.
   */
  readonly validateStepOptions?: (
    raw: AgentHarnessStepOverrides,
  ) => AgentHarnessStepOverrides;
  /**
   * Optional model-id catalog gate. When declared, the workflow validator
   * calls this with the step's resolved model string and the adapter throws
   * with a field-path message when the id is not one this harness can serve.
   * Adapters that genuinely accept any non-empty string (codex, gemini,
   * thin) leave this unset so the wire layer rejects unknown ids at call
   * time.
   *
   * The validator wraps the throw with step-label context before surfacing a
   * `WorkflowDefinitionError`. Returning normally signals acceptance.
   */
  readonly validateModelId?: (modelId: string) => void;
  run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult>;
};

const AGENT_HARNESS_DEFINITION_FIELDS = {
  readWeeklyQuota: true,
  name: true,
  description: true,
  supportsMultiTurn: true,
  supportedHookKinds: true,
  askOwnerToolName: true,
  emitsAgentMessageStream: true,
  toolControl: true,
  nativeAbortQuarantine: true,
  readiness: true,
  resolveIsolatedHostAuthEnv: true,
  unsupportedRunOptions: true,
  validateStepOptions: true,
  validateModelId: true,
  run: true,
} as const satisfies Record<keyof AgentHarness, true>;

const AGENT_HARNESS_DEFINITION_KEYS = new Set<string>(
  Object.keys(AGENT_HARNESS_DEFINITION_FIELDS),
);
const AGENT_HARNESS_UNSUPPORTED_OPTION_FIELDS = {
  runOption: true,
  option: true,
  reason: true,
} as const satisfies Record<keyof AgentHarnessUnsupportedOption, true>;
const AGENT_HARNESS_UNSUPPORTED_OPTION_KEYS = new Set<string>(
  Object.keys(AGENT_HARNESS_UNSUPPORTED_OPTION_FIELDS),
);
const HARNESS_HOOK_KINDS = new Set<string>(ALL_HARNESS_HOOK_KINDS);
const HARNESS_UNSUPPORTED_RUN_OPTION_KEYS = new Set<string>(
  AGENT_HARNESS_UNSUPPORTED_RUN_OPTION_KEYS,
);

function assertNonEmptyTrimmedString(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
}

function assertOptionalFunction(
  value: unknown,
  label: string,
): void {
  if (value !== undefined && typeof value !== "function") {
    throw new Error(`${label} must be a function when declared`);
  }
}

function assertUnsupportedRunOptions(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array when declared`);
  }
  for (const [index, entry] of value.entries()) {
    const entryLabel = `${label}[${index}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`${entryLabel} must be an object`);
    }
    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!AGENT_HARNESS_UNSUPPORTED_OPTION_KEYS.has(key)) {
        throw new Error(`${entryLabel} has unknown field "${key}"`);
      }
    }
    assertNonEmptyTrimmedString(record.option, `${entryLabel}.option`);
    assertNonEmptyTrimmedString(record.reason, `${entryLabel}.reason`);
    if (
      record.runOption !== undefined &&
      (typeof record.runOption !== "string" ||
        !HARNESS_UNSUPPORTED_RUN_OPTION_KEYS.has(record.runOption))
    ) {
      throw new Error(`${entryLabel}.runOption is invalid`);
    }
  }
}

/** Runtime decoder for module-contributed harness adapters. */
export function assertAgentHarnessDefinitions(
  moduleName: string,
  values: readonly unknown[],
): asserts values is readonly AgentHarness[] {
  for (const [index, value] of values.entries()) {
    const label = `Module "${moduleName}" agentHarness[${index}]`;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${label} must be an object`);
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!AGENT_HARNESS_DEFINITION_KEYS.has(key)) {
        throw new Error(`${label} has unknown field "${key}"`);
      }
    }
    for (const field of ["name", "description"] as const) {
      assertNonEmptyTrimmedString(record[field], `${label}.${field}`);
    }
    for (const field of ["supportsMultiTurn", "emitsAgentMessageStream"] as const) {
      if (typeof record[field] !== "boolean") throw new Error(`${label}.${field} must be a boolean`);
    }
    if (
      !Array.isArray(record.supportedHookKinds) ||
      record.supportedHookKinds.some((kind) =>
        typeof kind !== "string" || !HARNESS_HOOK_KINDS.has(kind),
      )
    ) {
      throw new Error(`${label}.supportedHookKinds contains an unsupported hook kind`);
    }
    if (new Set(record.supportedHookKinds).size !== record.supportedHookKinds.length) {
      throw new Error(`${label}.supportedHookKinds must not contain duplicates`);
    }
    if (
      record.askOwnerToolName !== null &&
      (typeof record.askOwnerToolName !== "string" ||
        record.askOwnerToolName.trim() !== record.askOwnerToolName ||
        record.askOwnerToolName.length === 0)
    ) {
      throw new Error(`${label}.askOwnerToolName must be null or a non-empty trimmed string`);
    }
    if (record.toolControl !== "kota" && record.toolControl !== "native") {
      throw new Error(`${label}.toolControl must be "kota" or "native"`);
    }
    if (
      record.nativeAbortQuarantine !== undefined &&
      record.nativeAbortQuarantine !== "confirmed-stop"
    ) {
      throw new Error(`${label}.nativeAbortQuarantine must be "confirmed-stop" when declared`);
    }
    assertOptionalFunction(record.readWeeklyQuota, `${label}.readWeeklyQuota`);
    assertOptionalFunction(record.readiness, `${label}.readiness`);
    assertOptionalFunction(
      record.resolveIsolatedHostAuthEnv,
      `${label}.resolveIsolatedHostAuthEnv`,
    );
    assertUnsupportedRunOptions(record.unsupportedRunOptions, `${label}.unsupportedRunOptions`);
    assertOptionalFunction(record.validateStepOptions, `${label}.validateStepOptions`);
    assertOptionalFunction(record.validateModelId, `${label}.validateModelId`);
    if (typeof record.run !== "function") throw new Error(`${label}.run must be a function`);
  }
}
