/**
 * Synthesis prompt for the answer seam.
 *
 * The prompt is tiny and internal. It instructs the model to produce one
 * short answer with inline `[source:id]` citation markers drawn from a
 * fixed list, and is co-located with the seam — there is no public knob
 * for tuning it from this task.
 */

import type { RecallHit } from "#core/server/kota-client.js";
import type { SynthesisInput } from "./answer-types.js";

const SYSTEM_PROMPT = [
  "You are KOTA's cited-answer synthesizer.",
  "You will receive an operator question plus a small numbered list of",
  "source snippets pulled from the operator's second brain.",
  "",
  "Compose ONE short answer (target two to four sentences, never more",
  "than six). The answer must cite each source you actually rely on by",
  "appending an inline marker in the form `[source:id]` immediately",
  "after the supporting clause. Use ONLY the source/id pairs supplied;",
  "do not invent new ones. If the available sources cannot answer the",
  "question, say so explicitly in one sentence (still cite the closest",
  "source if any).",
  "",
  "Output the answer prose only — no preamble, no headings, no",
  "bulleted lists.",
].join("\n");

export const ANSWER_SYNTHESIS_SYSTEM_PROMPT = SYSTEM_PROMPT;

function describeHit(hit: RecallHit): string {
  switch (hit.source) {
    case "knowledge":
      return `${hit.title} — ${hit.preview}`;
    case "memory":
      return hit.preview;
    case "history":
      return `${hit.title} (${hit.cwd})`;
    case "tasks":
      return `[${hit.state}/${hit.priority}] ${hit.title}`;
    case "answer":
      return `prior cited answer to "${hit.query}" — ${hit.preview}`;
  }
}

function renderHitLine(hit: RecallHit): string {
  return `- [${hit.source}:${hit.id}] ${describeHit(hit)}`;
}

export function buildSynthesisUserPrompt(input: SynthesisInput): string {
  const { query, hits, retry } = input;
  const sources = hits.map(renderHitLine).join("\n");
  const allowedMarkers = hits
    .map((h) => `[${h.source}:${h.id}]`)
    .join(" ");
  const retryNote = retry
    ? "\n\nNOTE: a previous attempt cited unknown sources. Restrict citation markers to exactly the list above and do not introduce new ids."
    : "";
  return [
    `Question: ${query}`,
    "",
    "Available sources:",
    sources,
    "",
    `Cite using ONLY these markers: ${allowedMarkers}`,
    retryNote,
  ].join("\n");
}
