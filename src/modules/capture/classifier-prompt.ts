/**
 * Classifier prompt for the capture seam.
 *
 * The prompt is tiny and internal. It instructs the model to pick one
 * `CaptureTarget` from the supplied list or return the literal token
 * `AMBIGUOUS`. There is no public knob — tuning the prompt lands as a
 * focused follow-up.
 *
 * Per-target descriptions live next to the prompt so adding a new
 * contributor extends both the union and this list in one place.
 */

import type { CaptureTarget } from "./capture-types.js";

const TARGET_DESCRIPTIONS: Record<CaptureTarget, string> = {
  memory:
    "memory — persistent agent notes about preferences, working state, and quick reminders.",
  knowledge:
    "knowledge — durable structured reference entries (definitions, learned rules, factual notes worth re-reading).",
  tasks:
    "tasks — actionable work items with a clear desired outcome (review X, fix Y, ship Z).",
  inbox:
    "inbox — raw thoughts and rough captures that have not been triaged into one of the other stores yet.",
};

export const CAPTURE_CLASSIFIER_SYSTEM_PROMPT = [
  "You are KOTA's cross-store capture classifier.",
  "You will receive an operator note plus a short list of available stores.",
  "Pick exactly one store the note belongs to and reply with that single",
  "store name on its own line. If the note could fit equally well in two or",
  "more stores or you cannot tell, reply with the single token `AMBIGUOUS`.",
  "Do not add prose, prefixes, suffixes, or punctuation — output only the",
  "store name or `AMBIGUOUS`.",
].join("\n");

export function buildClassifierUserPrompt(input: {
  text: string;
  hint?: string;
  available: ReadonlyArray<CaptureTarget>;
}): string {
  const lines: string[] = [];
  lines.push("Available stores:");
  for (const target of input.available) {
    lines.push(`- ${TARGET_DESCRIPTIONS[target]}`);
  }
  lines.push("");
  lines.push(`Note: ${input.text}`);
  if (input.hint !== undefined && input.hint !== "") {
    lines.push("");
    lines.push(`Hint: ${input.hint}`);
  }
  lines.push("");
  lines.push(
    `Reply with one of: ${input.available.join(", ")}, or AMBIGUOUS.`,
  );
  return lines.join("\n");
}

/**
 * Parse the raw model output into a typed classification. Strict: any
 * output other than an exact match against the available list or the
 * literal `AMBIGUOUS` token surfaces as ambiguous so the seam never
 * dispatches to a hallucinated store.
 */
export function parseClassifierOutput(
  raw: string,
  available: ReadonlyArray<CaptureTarget>,
):
  | { kind: "confident"; target: CaptureTarget }
  | { kind: "ambiguous" } {
  const flat = raw.trim().toLowerCase();
  if (flat === "ambiguous" || flat === "") return { kind: "ambiguous" };
  for (const target of available) {
    if (flat === target) return { kind: "confident", target };
  }
  return { kind: "ambiguous" };
}
