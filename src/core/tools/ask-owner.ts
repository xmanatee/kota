/**
 * ask_owner tool — escalate a high-stakes decision to the repo owner and
 * block until the owner answers, dismisses, or the question times out.
 *
 * Agents should reach for this only when proceeding with best judgment is
 * genuinely unsafe (ambiguous architectural direction, scope escalations,
 * irreversible changes). The review gate enforces a structural quality bar
 * before a question is enqueued.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { OwnerQuestionQueue, PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import { getOwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { reviewOwnerQuestion } from "#core/daemon/owner-question-review.js";
import type { ToolResult } from "./index.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

export const askOwnerTool: Anthropic.Tool = {
  name: "ask_owner",
  description:
    "Escalate a high-stakes decision to the repo owner and block until they answer. " +
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
        description: "How long to wait for an answer before returning. Default 600 (10 minutes).",
      },
    },
    required: ["context", "question", "reason"],
  },
};

type Clock = {
  now(): number;
  sleep(ms: number): Promise<void>;
};

const defaultClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

type Deps = {
  queue: () => OwnerQuestionQueue;
  clock: Clock;
  source: () => string;
};

let currentDeps: Deps = {
  queue: () => getOwnerQuestionQueue(),
  clock: defaultClock,
  source: () => process.env.KOTA_SESSION_ID ?? process.env.KOTA_RUN_ID ?? "agent",
};

export function setAskOwnerDeps(deps: Partial<Deps>): void {
  currentDeps = { ...currentDeps, ...deps };
}

export function resetAskOwnerDeps(): void {
  currentDeps = {
    queue: () => getOwnerQuestionQueue(),
    clock: defaultClock,
    source: () => process.env.KOTA_SESSION_ID ?? process.env.KOTA_RUN_ID ?? "agent",
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

  const deadline = activeDeps.clock.now() + timeoutMs;
  let current: PendingOwnerQuestion | null = item;
  while (activeDeps.clock.now() < deadline) {
    current = queue.get(item.id);
    if (!current) {
      return { content: `Owner question [${item.id}] disappeared from queue`, is_error: true };
    }
    if (current.status === "answered") {
      return { content: `Owner answered [${item.id}]: ${current.answer ?? ""}` };
    }
    if (current.status === "dismissed") {
      const detail = current.dismissalReason ? `: ${current.dismissalReason}` : "";
      return { content: `Owner dismissed [${item.id}]${detail} — proceed with your best judgment or unblock the work.` };
    }
    if (current.status === "expired") {
      return { content: `Owner question [${item.id}] expired without an answer — proceed with your best judgment based on available context.` };
    }
    await activeDeps.clock.sleep(POLL_INTERVAL_MS);
  }

  const final = queue.get(item.id);
  if (final?.status === "answered") {
    return { content: `Owner answered [${item.id}]: ${final.answer ?? ""}` };
  }
  if (final?.status === "pending") queue.expire(item.id, "ask_owner:timeout");
  return {
    content: `Owner question [${item.id}] timed out after ${Math.round(timeoutMs / 1000)}s — proceed with your best judgment based on available context.`,
  };
}

function normalizeProposed(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((v): v is string => typeof v === "string").map((s) => s.trim()).filter(Boolean);
  return strings.length > 0 ? strings : undefined;
}

export const registration = {
  tool: askOwnerTool,
  runner: runAskOwner,
  risk: "safe" as const,
  kind: "action" as const,
  group: "management",
};
