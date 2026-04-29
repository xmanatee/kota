// Source/date/primitives/revisit metadata for the "External Pattern
// Decisions" catalog in src/modules/autonomy/AGENTS.md. The verdict bullet
// stays in AGENTS.md (concise label + decision + reasoning); this module
// holds the operational fields needed to revisit a decision later. The
// catalog test enforces 1:1 correspondence between the AGENTS.md bullets
// and the entries here.

export type ExternalPatternVerdict = "adopt" | "reject" | "read" | "defer";

export type ExternalPatternDecision = {
  /**
   * Pattern label as it appears as the bold lead-in (between the leading
   * `**` and the trailing `.**`) on the bullet in
   * `src/modules/autonomy/AGENTS.md` under "## External Pattern Decisions".
   * The catalog test asserts 1:1 correspondence by this label.
   */
  pattern: string;
  verdict: ExternalPatternVerdict;
  /** Human-readable citation: vendor docs, blog post, paper, or repo. */
  source: string;
  /** Date the source was read, in ISO `YYYY-MM-DD` form. */
  date: string;
  /** KOTA primitives the verdict is decided against. */
  kotaPrimitives: readonly string[];
  /**
   * Concrete change in the external system that would re-open the verdict.
   * Avoid open-ended "if better" phrasing; name a primitive, capability,
   * or evidence shape that does not exist today.
   */
  revisitWhen: string;
};

export const EXTERNAL_PATTERN_DECISIONS: readonly ExternalPatternDecision[] = [
  {
    pattern: "Workflow DSLs (crewAI Flows, LangGraph Pregel)",
    verdict: "reject",
    source: "crewAI Flows guide and LangGraph Pregel reference docs",
    date: "2026-04-20",
    kotaPrimitives: ["workflow", "run-artifact", "recovery"],
    revisitWhen:
      "A peer ships a durable graph-execution primitive whose semantics " +
      "the definition-driven `workflow` + run-artifact + recovery model " +
      "cannot express.",
  },
  {
    pattern: "Vercel AI SDK split",
    verdict: "adopt",
    source: "vercel.com AI SDK announcement and ai-sdk.dev reference",
    date: "2026-04-09",
    kotaPrimitives: ["daemon", "client"],
    revisitWhen:
      "A peer obsoletes the daemon/client split (e.g. proves a single " +
      "in-process surface scales across operator, channel, and client " +
      "needs without losing isolation).",
  },
  {
    pattern: "Typed multi-agent handoffs (OpenHands, AutoGen)",
    verdict: "adopt",
    source: "OpenHands handoff docs and AutoGen multi-agent samples",
    date: "2026-04-20",
    kotaPrimitives: ["bus event", "trigger step", "agent"],
    revisitWhen:
      "A peer ships a handoff primitive that adds typed semantics our bus " +
      "events plus `trigger` steps cannot model (e.g. resumable cross- " +
      "agent state machines with checkpointed transitions).",
  },
  {
    pattern: "Labeled memory blocks (Letta) / runtime skill stores (Hermes)",
    verdict: "reject",
    source: "Letta memory-blocks docs and Hermes self-promoted-skills post",
    date: "2026-04-20",
    kotaPrimitives: ["typed stores", "scoped AGENTS.md", "improver"],
    revisitWhen:
      "Repeated run evidence shows typed stores plus scoped `AGENTS.md` " +
      "cannot capture a labeled-persistence shape we need, AND a peer's " +
      "self-promoted runtime skill store demonstrates measurable safety " +
      "over operator/improver curation.",
  },
  {
    pattern: "Verbal self-reflection / strategy banks (Reflexion, ReasoningBank)",
    verdict: "reject",
    source: "Reflexion paper (NeurIPS 2023) and ReasoningBank summary",
    date: "2026-04-20",
    kotaPrimitives: ["improver", "scoped AGENTS.md", "run artifacts"],
    revisitWhen:
      "Improver no longer reliably distils repeated failures into scoped " +
      "`AGENTS.md` rules, AND a peer shows a self-reflection primitive " +
      "that beats run-artifact-driven distillation on long horizons.",
  },
  {
    pattern: "Routines / scheduled agents",
    verdict: "adopt",
    source: "OpenAI Agents SDK routines and scheduled-agents posts",
    date: "2026-04-20",
    kotaPrimitives: ["workflow trigger"],
    revisitWhen:
      "Adopted; revisit only if a peer's scheduling primitive adds " +
      "guarantees (e.g. exactly-once cross-host execution) that the " +
      "`workflow` trigger model cannot offer.",
  },
  {
    pattern: "Multi-agent coordination patterns",
    verdict: "adopt",
    source: "Peer task/process coordination distillation set",
    date: "2026-04-20",
    kotaPrimitives: [
      "builder",
      "critic",
      "delegate",
      "composition",
      "dispatcher",
      "bus",
      "stores",
    ],
    revisitWhen:
      "A peer ships a coordination primitive (generator-verifier, " +
      "orchestrator-subagent, teams, shared state) that does not map " +
      "cleanly onto the existing builder/critic + delegate/composition + " +
      "dispatcher + bus + stores set.",
  },
  {
    pattern: "Parallel-agent desktop UIs",
    verdict: "read",
    source: "Claude Code, Codex, Gemini CLI desktop client surveys",
    date: "2026-04-19",
    kotaPrimitives: ["client", "daemon control API"],
    revisitWhen:
      "A peer's desktop UI proves a runtime-host capability our " +
      "daemon-backed thin-client model cannot deliver, OR raises the " +
      "operator-visibility bar in a way clients cannot reach.",
  },
  {
    pattern: "Managed Agents / brain-hands decoupling",
    verdict: "reject",
    source: "Anthropic engineering posts on Managed Agents (April 2026)",
    date: "2026-04-23",
    kotaPrimitives: [
      "daemon",
      "session",
      "workflow",
      "run-artifact",
      "guardrails",
      "injection-defense",
    ],
    revisitWhen:
      "Daemon + session + workflow + run-artifact stops covering brain/ " +
      "hands separation under a real workload, OR a peer's managed-agent " +
      "primitive offers credential isolation our guardrails cannot match.",
  },
  {
    pattern: "Claude Code auto mode + sandboxing",
    verdict: "read",
    source: "Anthropic Claude Code auto mode and sandbox docs",
    date: "2026-04-23",
    kotaPrimitives: [
      "autonomy mode",
      "approval-queue",
      "injection-defense",
      "tool-risk guardrails",
    ],
    revisitWhen:
      "A peer ships a sandboxing or autonomy-mode primitive that splits " +
      "input-probe/output-classifier responsibilities in a way our " +
      "current rails cannot match.",
  },
  {
    pattern: "Harness design for long-running apps",
    verdict: "read",
    source: "Anthropic engineering long-running-app harness post",
    date: "2026-04-23",
    kotaPrimitives: [
      "decomposer",
      "builder",
      "critic",
      "success-criteria*.txt",
      "run-artifact",
    ],
    revisitWhen:
      "Reset-over-compact + pre-code sprint contracts stop covering an " +
      "observed long-horizon failure shape, OR a peer's harness ships a " +
      "primitive our planner/generator/evaluator triad cannot express.",
  },
  {
    pattern: "Multi-Claude parallel builds",
    verdict: "reject",
    source: "Anthropic Claude Code multi-instance/parallel-builds post",
    date: "2026-04-23",
    kotaPrimitives: ["builder", "critic", "git worktree posture"],
    revisitWhen:
      "One-task-WIP through builder/critic stops scaling to a queue " +
      "shape we need, AND a peer demonstrates a parallel-builder + " +
      "git-locks coordination primitive without introducing a second " +
      "coordination surface.",
  },
  {
    pattern: "Claude Code 1M context + session management",
    verdict: "reject",
    source: "Anthropic Claude Code 1M-context and session-management post",
    date: "2026-04-23",
    kotaPrimitives: ["fresh-session-per-step", "run-artifact handoff"],
    revisitWhen:
      "Fresh-session-per-step + run-artifact handoff stops handling a " +
      "real long-horizon workflow, OR a peer's interactive-session " +
      "rewind/compact/clear primitive demonstrably beats reset-over- " +
      "compact at the workflow layer.",
  },
  {
    pattern: "Production MCP agent integration",
    verdict: "read",
    source: "Anthropic MCP production-integration writeup",
    date: "2026-04-23",
    kotaPrimitives: ["mcp-server module", "tool registry"],
    revisitWhen:
      "MCP evolves to require its own registry semantics that the " +
      "existing tool registry plus `mcp-server` transport cannot model.",
  },
  {
    pattern: "AGI capability scoring / behavioral-disposition alignment",
    verdict: "reject",
    source: "Anthropic AGI capability-scoring / disposition-alignment post",
    date: "2026-04-23",
    kotaPrimitives: ["eval-harness"],
    revisitWhen:
      "A first-party operator threat model emerges that `eval-harness` " +
      "task-outcome scoring genuinely cannot evaluate.",
  },
  {
    pattern: "Microsoft Agent Framework (AutoGen successor)",
    verdict: "reject",
    source: "Microsoft Agent Framework launch docs and GitHub repo",
    date: "2026-04-23",
    kotaPrimitives: [
      "workflow",
      "bus event",
      "trigger step",
      "daemon",
      "client",
    ],
    revisitWhen:
      "Microsoft ships a graph-DSL or checkpoint primitive whose " +
      "semantics our definition-driven workflow + bus + trigger steps + " +
      "daemon/client split cannot express.",
  },
  {
    pattern: "Harness-as-shell (inference.sh)",
    verdict: "read",
    source: "inference.sh docs and \"harness is a shell\" writeup",
    date: "2026-04-25",
    kotaPrimitives: ["tool", "module", "daemon", "workflow", "client"],
    revisitWhen:
      "A peer's harness-as-shell primitive (versioned app contract, " +
      "scheduler, flows, portability) demonstrates a capability our " +
      "typed `tool` + pinned `module` + `daemon` + `workflow` + `client` " +
      "set cannot deliver.",
  },
];
