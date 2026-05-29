/**
 * Tool effect protocol — a structured descriptor of what a tool does.
 *
 * Replaces the coarse `risk: safe|moderate|dangerous` + `kind: discovery|action`
 * metadata with explicit semantics so guardrails, autonomy mode, MCP annotations,
 * and operator surfaces can reason about a tool from one source of truth.
 *
 * Tools declare an effect at registration. Risk-tier (used by guardrails policy
 * and autonomy gating) and MCP annotations are derived from the effect, not from
 * parallel name lists.
 */

/**
 * What the tool's primary action does on the surface it touches.
 *
 * - `read`        — pure observation; no state change.
 * - `write`       — creates or modifies state; recoverable.
 * - `destructive` — deletes data, sends an external mutation, or otherwise
 *                   produces non-recoverable changes.
 */
export type ToolEffectKind = "read" | "write" | "destructive";

/**
 * Surface the tool acts upon. Drives capability scope and exfiltration risk.
 *
 * - `session`          — in-memory session state (todo list, working memory).
 * - `local-fs`         — host filesystem under the project root.
 * - `daemon-state`     — persisted KOTA state (modules, queues, history,
 *                        approvals, scheduler).
 * - `process-env`      — host process environment inherited by later tools.
 * - `external-network` — outbound network call (HTTP, MCP server, third-party
 *                        SaaS).
 * - `operator-surface` — surface visible to the operator (notifications,
 *                        approval queue, ask_owner, ask_user).
 */
export type ToolEffectScope =
  | "session"
  | "local-fs"
  | "daemon-state"
  | "process-env"
  | "external-network"
  | "operator-surface";

/**
 * A first-class declaration of what a tool does. Every registered tool must
 * carry one. Authors are encouraged to use the convenience builders below.
 */
export type ToolEffect = {
  /** Action class. */
  kind: ToolEffectKind;
  /** Surface acted upon. */
  scope: ToolEffectScope;
  /**
   * Re-running the tool with the same input lands at the same end state.
   * Read tools are typically idempotent; mutating tools usually are not.
   */
  idempotent: boolean;
  /**
   * Tool reads from or affects systems outside KOTA's control (the public
   * web, external SaaS APIs, the user's GUI). Open-world tools have higher
   * exfiltration / supply-chain risk and surface as `openWorldHint` over
   * MCP.
   */
  openWorld: boolean;
};

// ─── Convenience builders ─────────────────────────────────────────────

/** Read-only access to local filesystem state. */
export function readOnlyLocalEffect(): ToolEffect {
  return { kind: "read", scope: "local-fs", idempotent: true, openWorld: false };
}

/** Read-only access to in-session state (e.g. todo list, working memory snapshot). */
export function readOnlySessionEffect(): ToolEffect {
  return { kind: "read", scope: "session", idempotent: true, openWorld: false };
}

/** Read-only inspection of persisted KOTA daemon state. */
export function readOnlyDaemonEffect(): ToolEffect {
  return { kind: "read", scope: "daemon-state", idempotent: true, openWorld: false };
}

/** Mutates state on the local filesystem. */
export function localWriteEffect(opts?: { idempotent?: boolean }): ToolEffect {
  return {
    kind: "write",
    scope: "local-fs",
    idempotent: opts?.idempotent ?? false,
    openWorld: false,
  };
}

/** Mutates KOTA daemon state (queues, approvals, scheduler entries). */
export function daemonWriteEffect(opts?: { idempotent?: boolean }): ToolEffect {
  return {
    kind: "write",
    scope: "daemon-state",
    idempotent: opts?.idempotent ?? false,
    openWorld: false,
  };
}

/** Injects a credential into the host process environment for later tool calls. */
export function credentialInjectionEffect(): ToolEffect {
  return {
    kind: "write",
    scope: "process-env",
    idempotent: false,
    openWorld: false,
  };
}

/** Coordinates session state (todo list edits, ephemeral notes). */
export function sessionWriteEffect(opts?: { idempotent?: boolean }): ToolEffect {
  return {
    kind: "write",
    scope: "session",
    idempotent: opts?.idempotent ?? false,
    openWorld: false,
  };
}

/** Read from an external service (HTTP GET, GitHub list, web search). */
export function networkReadEffect(): ToolEffect {
  return { kind: "read", scope: "external-network", idempotent: false, openWorld: true };
}

/** Mutate external state (HTTP POST/PUT, external API write). */
export function networkWriteEffect(): ToolEffect {
  return { kind: "write", scope: "external-network", idempotent: false, openWorld: true };
}

/** Destructive external mutation (delete, merge, irreversible publish). */
export function networkDestructiveEffect(): ToolEffect {
  return { kind: "destructive", scope: "external-network", idempotent: false, openWorld: true };
}

/**
 * Destructive mutation of state on the local filesystem (delete files, drop
 * a database table, retract a captured store entry). Same risk tier as a
 * destructive network call but without the open-world MCP hint.
 */
export function localDestructiveEffect(): ToolEffect {
  return { kind: "destructive", scope: "local-fs", idempotent: false, openWorld: false };
}

/** Surfaces a request to the operator (ask_user, notification, approval). */
export function operatorSurfaceEffect(opts?: { destructive?: boolean }): ToolEffect {
  return {
    kind: opts?.destructive ? "destructive" : "write",
    scope: "operator-surface",
    idempotent: false,
    openWorld: false,
  };
}

// ─── External-format adapter helper ───────────────────────────────────
//
// `legacyEffect` is the translation seam for *external* tool formats whose
// public schema is the two-axis (risk, kind) classification — namely the
// SimpleTool / OpenAIFunctionTool / Vercel AI SDK adapters in
// `tool-adapters.ts`, plus tests that exercise effect-derivation paths.
//
// Production module code must not call `legacyEffect()` — declare the
// concrete effect directly (e.g. `readOnlyLocalEffect()`,
// `networkDestructiveEffect()`, etc.). The
// `effect-no-legacy-callers.test.ts` guard enforces this mechanically: a
// new caller in `src/modules/` or in a non-adapter file under `src/core/`
// fails the test.

/** Legacy coarse risk tier, retained only for external-format adapters. */
export type LegacyRisk = "safe" | "moderate" | "dangerous";
/** Legacy coarse capability kind, retained only for external-format adapters. */
export type LegacyKind = "discovery" | "action";

/**
 * Translate the two-axis (risk, kind) classification used by external tool
 * formats into a structured effect. Reserved for the
 * `tool-adapters.ts` boundary; new production callers must use the
 * concrete effect builders above.
 */
export function legacyEffect(input: {
  risk: LegacyRisk;
  kind: LegacyKind;
  openWorld?: boolean;
}): ToolEffect {
  const { risk, kind, openWorld } = input;
  const open = openWorld ?? false;
  if (risk === "dangerous") {
    return { kind: "destructive", scope: "external-network", idempotent: false, openWorld: true };
  }
  if (risk === "safe" && kind === "discovery") {
    return { kind: "read", scope: open ? "external-network" : "local-fs", idempotent: true, openWorld: open };
  }
  if (risk === "safe" && kind === "action") {
    return { kind: "write", scope: "daemon-state", idempotent: false, openWorld: open };
  }
  // moderate
  return {
    kind: "write",
    scope: open ? "external-network" : "local-fs",
    idempotent: false,
    openWorld: open,
  };
}

// ─── Derivations ──────────────────────────────────────────────────────

export type RiskTier = "safe" | "moderate" | "dangerous";

/**
 * Derive guardrail risk tier from effect.
 *
 * Mapping:
 *   destructive                                    → dangerous
 *   read,        !openWorld                        → safe
 *   read,        openWorld                         → moderate
 *   write,       scope ∈ {session,
 *                         operator-surface,
 *                         daemon-state}            → safe   (internal coordination)
 *   write,       scope ∈ {process-env,
 *                         local-fs,
 *                         external-network}        → moderate
 *
 * Internal-coordination writes (todo edits, approval queue updates, operator
 * prompts) do not need policy gating — they are the primitives the agent uses
 * to coordinate with the operator and the runtime, not state mutations the
 * guardrails layer needs to inspect.
 *
 * Conservative-by-default: a malformed effect would only land at moderate or
 * dangerous, never silently safe.
 */
export function riskFromEffect(effect: ToolEffect): RiskTier {
  if (effect.kind === "destructive") return "dangerous";
  if (effect.kind === "read") {
    return effect.openWorld ? "moderate" : "safe";
  }
  // write
  switch (effect.scope) {
    case "session":
    case "operator-surface":
    case "daemon-state":
      return "safe";
    case "process-env":
    case "local-fs":
    case "external-network":
      return "moderate";
  }
}

/** MCP `tools/list` annotations as documented in the MCP spec. */
export type McpToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
  idempotentHint?: boolean;
};

/** Derive MCP annotations from a tool's effect. */
export function mcpAnnotationsFromEffect(effect: ToolEffect): McpToolAnnotations {
  return {
    readOnlyHint: effect.kind === "read",
    destructiveHint: effect.kind === "destructive",
    idempotentHint: effect.idempotent,
    openWorldHint: effect.openWorld,
  };
}
