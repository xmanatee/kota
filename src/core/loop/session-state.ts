/**
 * Session State Machine — explicit lifecycle states for AgentSession.
 *
 * Maps to the ReAct pattern: THINKING → ACTING → OBSERVING → THINKING.
 * Inspired by OpenHands' ConversationExecutionStatus and the canonical
 * IDLE/THINKING/ACTING/OBSERVING agent state model.
 *
 * Benefits: deterministic lifecycle, tool gating by state, progress
 * reporting, pause/resume foundation, loop/stuck detection.
 */

/** All possible session states. */
export type SessionState =
  | "idle"          // Created, not yet initialized
  | "initializing"  // Loading modules, modules, MCP
  | "ready"         // Initialized, waiting for user prompt
  | "thinking"      // LLM generating a response
  | "acting"        // Executing tool calls
  | "reflecting"    // Self-reflection pass
  | "error"         // Recoverable error state
  | "closed";       // Terminal — session ended

/** Valid state transitions. Key = from state, value = allowed target states. */
const TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  idle:         ["initializing", "closed"],
  initializing: ["ready", "error", "closed"],
  ready:        ["thinking", "closed"],
  thinking:     ["acting", "reflecting", "ready", "error", "closed"],
  acting:       ["thinking", "error", "closed"],
  reflecting:   ["thinking", "error", "closed"],
  error:        ["ready", "thinking", "closed"],
  closed:       [],
};

export type StateChangeListener = (
  from: SessionState,
  to: SessionState,
  meta?: Record<string, unknown>,
) => void;

/**
 * Enforces valid state transitions and notifies listeners on change.
 * Lightweight — no async, no side effects beyond listener callbacks.
 */
export class SessionStateMachine {
  private state: SessionState = "idle";
  private listeners: StateChangeListener[] = [];
  private history: Array<{ from: SessionState; to: SessionState; ts: number }> = [];
  private readonly maxHistory: number;

  constructor(opts?: { maxHistory?: number }) {
    this.maxHistory = opts?.maxHistory ?? 50;
  }

  /** Current state. */
  current(): SessionState {
    return this.state;
  }

  /** Whether the session has reached a terminal state. */
  isTerminal(): boolean {
    return this.state === "closed";
  }

  /** Whether the session is actively processing (thinking, acting, reflecting). */
  isProcessing(): boolean {
    return this.state === "thinking" || this.state === "acting" || this.state === "reflecting";
  }

  /**
   * Transition to a new state. Throws if the transition is invalid.
   * No-op if already in the target state.
   */
  transition(to: SessionState, meta?: Record<string, unknown>): void {
    if (this.state === to) return;
    const allowed = TRANSITIONS[this.state];
    if (!allowed.includes(to)) {
      throw new Error(
        `Invalid state transition: ${this.state} → ${to}. Allowed: [${allowed.join(", ")}]`,
      );
    }
    const from = this.state;
    this.state = to;
    this.history.push({ from, to, ts: Date.now() });
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }
    for (const listener of this.listeners) {
      listener(from, to, meta);
    }
  }

  /** Check if a transition is valid without performing it. */
  canTransition(to: SessionState): boolean {
    return this.state !== to && TRANSITIONS[this.state].includes(to);
  }

  /** Register a listener for state changes. Returns unsubscribe function. */
  onChange(listener: StateChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /** Recent transition history (most recent last). */
  getHistory(): ReadonlyArray<{ from: SessionState; to: SessionState; ts: number }> {
    return this.history;
  }

  /** Count consecutive transitions into a specific state — useful for loop detection. */
  consecutiveCount(target: SessionState): number {
    let count = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].to === target) count++;
      else break;
    }
    return count;
  }
}
