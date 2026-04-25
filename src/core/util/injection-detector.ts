/**
 * Structural injection-pattern detector — cheap first-pass classifier over
 * untrusted text (web ingest, operator answers, agent-routed message bodies).
 * Returns a verdict plus the reasons the content looked suspicious, for both
 * annotation and audit.
 *
 * The detector is intentionally conservative: it flags obvious
 * prompt-injection shapes (role markers, override phrases, hidden payloads,
 * zero-width characters) and leaves deep semantic classification to a later
 * stage. A false positive annotates content; a false negative lets content
 * through with only the caller's other gating. Both costs are bounded and
 * the consumer always sees the original payload alongside the warning.
 *
 * The injection-defense module wraps this primitive in a tool middleware;
 * the workflow-runtime ask-owner step pattern uses it to screen operator
 * answers before they reach a resuming agent step's trigger envelope.
 */

const OVERRIDE_PHRASES: RegExp[] = [
  /\bignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|rules?|prompts?|directions?|orders?)\b/i,
  /\bdisregard\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|rules?|prompts?|directions?)\b/i,
  /\bforget\s+(?:all\s+|any\s+|everything|the)\s+(?:previous|prior|above|earlier)\b/i,
  /\boverride\s+(?:the\s+|your\s+)?(?:system\s+prompt|instructions?|rules?|safety)\b/i,
  /\bnew\s+(?:instructions?|system\s+prompt|task)\s*[:-]/i,
  /\byou\s+are\s+now\s+(?:a\s+|an\s+)?(?!just\b|only\b|fully\b|completely\b)\w+/i,
  /\bact\s+as\s+(?:a\s+|an\s+)?(?:different|new)\s+\w+/i,
  /\bpretend\s+(?:to\s+be|you\s+are)\b/i,
  /\bjailbreak\b/i,
  /\bDAN\s+mode\b/i,
  /\bexfiltrate\b/i,
];

const ROLE_MARKERS: RegExp[] = [
  /<\s*\/?\s*(?:system|assistant|user|human|tool)\s*>/i,
  /\[\s*(?:system|assistant|user|human)\s*\]\s*[:-]/i,
  /^\s*(?:system|assistant|user|human)\s*[:-]/im,
  /\[\s*INST\s*\]|\[\s*\/INST\s*\]/,
  /<\|im_start\|>|<\|im_end\|>/,
];

const TOOL_LIKE_BLOCKS: RegExp[] = [
  /\{\s*"type"\s*:\s*"tool_use"/,
  /```\s*(?:tool|system|anthropic|claude)\b/i,
  /\bcall_tool\s*\(/,
  /<\s*tool_call\b/i,
];

const HIDDEN_MARKERS: RegExp[] = [
  /<!--\s*(?:instruction|prompt|system|override)[\s\S]*?-->/i,
];

const ZERO_WIDTH = /[​-‏‪-‮⁦-⁩﻿]/;

/** Content is safely ignorable below this length (reduces noise on empty bodies). */
const MIN_SCAN_LENGTH = 1;

export type InjectionVerdict = {
  suspicious: boolean;
  /** Non-empty when suspicious; stable machine-readable tags for audit. */
  reasons: string[];
};

type Rule = { tag: string; patterns: RegExp[] };

const RULES: Rule[] = [
  { tag: "override-phrase", patterns: OVERRIDE_PHRASES },
  { tag: "role-marker", patterns: ROLE_MARKERS },
  { tag: "tool-like-block", patterns: TOOL_LIKE_BLOCKS },
  { tag: "hidden-instruction", patterns: HIDDEN_MARKERS },
];

export function detectInjection(content: string): InjectionVerdict {
  if (content.length < MIN_SCAN_LENGTH) {
    return { suspicious: false, reasons: [] };
  }

  const reasons: string[] = [];
  for (const { tag, patterns } of RULES) {
    if (patterns.some((p) => p.test(content))) {
      reasons.push(tag);
    }
  }
  if (ZERO_WIDTH.test(content)) {
    reasons.push("zero-width-chars");
  }
  return { suspicious: reasons.length > 0, reasons };
}
