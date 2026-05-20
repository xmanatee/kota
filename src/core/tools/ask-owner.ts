/**
 * ask_owner tool — escalate a high-stakes decision to the repo owner.
 *
 * The tool is enqueue-only. It validates the question, places it on the
 * owner-question queue, and returns the question id. It does not block the
 * agent's tool loop waiting for an answer. Workflow code that wants to wait
 * composes the step-pattern recipe in
 * `#core/tools/ask-owner-step.js` (ask -> await-event -> consume); the
 * workflow runtime owns the wait via the pausable `await-event` step
 * primitive and survives a daemon restart mid-wait.
 *
 * In interactive (non-workflow) sessions the tool is fire-and-forget. Use
 * `ask_user` for direct conversational input; `ask_owner` is for asynchronous
 * operator escalation that may be answered after the current turn ends.
 *
 * Agents should reach for this only when proceeding with best judgment is
 * genuinely unsafe (ambiguous architectural direction, scope escalations,
 * irreversible changes). The review gate enforces a structural quality bar
 * before a question is enqueued.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { getOwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { reviewOwnerQuestion } from "#core/daemon/owner-question-review.js";
import { operatorSurfaceEffect } from "./effect.js";
import type { ToolResult } from "./index.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

// Async-local storage so concurrent agent runs (e.g. parallel workflow step
// groups) can each pin their own source string without clobbering a shared
// global. Adapters call `runWithAskOwnerSource(source, () => harness.run(...))`
// around their tool loop; `runAskOwner` reads the innermost bound value
// before falling back to deps or env.
const askOwnerSourceContext = new AsyncLocalStorage<string>();

export function runWithAskOwnerSource<T>(source: string, fn: () => Promise<T>): Promise<T> {
  return askOwnerSourceContext.run(source, fn);
}

export const askOwnerTool: KotaTool = {
  name: "ask_owner",
  description:
    "Enqueue a question for the repo owner and return immediately. " +
    "The workflow runtime (or operator UI) is responsible for awaiting and routing the answer. " +
    "Use only when proceeding with best judgment is genuinely unsafe (ambiguous architectural " +
    "direction, scope change, irreversible action). Structural review rejects low-quality questions " +
    "before the owner sees them. Prefer self-directed investigation and ask_user in interactive contexts.",
  input_schema: {
    type: "object" as const,
    properties: {
      context: {
        type: "string",
        description: "Brief background: what you are working on and the decision point you reached.",
      },
      question: {
        type: "string",
        description: "A single concrete question ending with `?`.",
      },
      reason: {
        type: "string",
        description: "Why owner input is required rather than proceeding on best judgment.",
      },
      proposed_answers: {
        type: "array",
        items: { type: "string" },
        description: "Optional short list (max 6) of concrete options the owner can pick from.",
      },
      timeout_seconds: {
        type: "number",
        description:
          "How long the queue may keep this question pending before the operator-question expirer resolves it with the question's default resolution. Default 600 (10 minutes).",
      },
    },
    required: ["context", "question", "reason"],
  },
};

type Deps = {
  queue: () => OwnerQuestionQueue;
  source: () => string;
};

function envFallbackSource(): string {
  return (
    askOwnerSourceContext.getStore() ??
    process.env.KOTA_SESSION_ID ??
    process.env.KOTA_RUN_ID ??
    "agent"
  );
}

let currentDeps: Deps = {
  queue: () => getOwnerQuestionQueue(),
  source: envFallbackSource,
};

export function setAskOwnerDeps(deps: Partial<Deps>): void {
  currentDeps = { ...currentDeps, ...deps };
}

export function resetAskOwnerDeps(): void {
  currentDeps = {
    queue: () => getOwnerQuestionQueue(),
    source: envFallbackSource,
  };
}

export async function runAskOwner(
  input: Record<string, unknown>,
  deps: Partial<Deps> = {},
): Promise<ToolResult> {
  const activeDeps = { ...currentDeps, ...deps };
  const context = typeof input.context === "string" ? input.context : "";
  const question = typeof input.question === "string" ? input.question : "";
  const reason = typeof input.reason === "string" ? input.reason : "";
  const proposedAnswers = normalizeProposed(input.proposed_answers);
  const timeoutSecondsRaw = typeof input.timeout_seconds === "number" ? input.timeout_seconds : null;
  const timeoutMs = timeoutSecondsRaw !== null ? Math.max(1, Math.floor(timeoutSecondsRaw)) * 1000 : DEFAULT_TIMEOUT_MS;

  const queue = activeDeps.queue();
  const recent = queue.list().slice(-100);
  const review = reviewOwnerQuestion({ context, question, reason, proposedAnswers }, recent);
  if (!review.ok) {
    return { content: `Question rejected by review gate: ${review.reason}`, is_error: true };
  }

  const item = queue.enqueue({
    context,
    question,
    reason,
    source: activeDeps.source(),
    ...(proposedAnswers && proposedAnswers.length > 0 && { proposedAnswers }),
    timeoutMs,
    defaultResolution: "dismiss",
  });

  return {
    content:
      `Owner question [${item.id}] enqueued. ` +
      `An operator will be notified through configured channels; ` +
      `the answer flows back through the workflow runtime via the await-event step. ` +
      `Your turn ends here — do not poll, the runtime owns the wait.`,
  };
}

function normalizeProposed(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((v): v is string => typeof v === "string").map((s) => s.trim()).filter(Boolean);
  return strings.length > 0 ? strings : undefined;
}

export const registration = {
  tool: askOwnerTool,
  runner: (input: Parameters<typeof runAskOwner>[0]) => runAskOwner(input),
  effect: operatorSurfaceEffect(),
  group: "management",
};
