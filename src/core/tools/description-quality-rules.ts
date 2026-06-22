import type { KotaToolInputSchema } from "#core/agent-harness/message-protocol.js";

const PURPOSE_VERBS = new Set([
  "add",
  "ask",
  "call",
  "capture",
  "check",
  "close",
  "confirm",
  "connect",
  "create",
  "delete",
  "delegate",
  "discover",
  "execute",
  "fetch",
  "find",
  "generate",
  "get",
  "inspect",
  "list",
  "load",
  "look",
  "looks",
  "manage",
  "merge",
  "move",
  "open",
  "query",
  "read",
  "reject",
  "render",
  "resolve",
  "run",
  "save",
  "search",
  "send",
  "store",
  "transcribe",
  "update",
  "use",
  "validate",
  "write",
]);

const GENERIC_DESCRIPTION_PHRASES = [
  "a tool",
  "do it",
  "do stuff",
  "does things",
  "execute tool",
  "perform action",
  "run tool",
  "this tool",
  "tool to",
  "use this tool",
];

const NEGATIVE_GUIDANCE_MARKERS = [
  "avoid",
  "do not",
  "don't",
  "instead",
  "never",
  "not for",
  "not use",
  "only use",
  "prefer",
  "reserved for",
  "unless",
];

const INPUT_EXPECTATION_MARKERS = [
  "argument",
  "field",
  "input",
  "parameter",
  "provide",
  "requires",
  "with",
];

const OUTPUT_EXPECTATION_MARKERS = [
  "content",
  "emits",
  "output",
  "produce",
  "produces",
  "result",
  "return",
  "returns",
  "structured",
  "writes",
];

export function normalizeDescription(description: string | undefined): string {
  return (description ?? "").replace(/\s+/g, " ").trim();
}

export function wordsIn(description: string): string[] {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9_ -]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function isGenericDescription(description: string, words: readonly string[]): boolean {
  const normalized = description.toLowerCase();
  if (words.length <= 4 && words.some((word) => word === "tool" || word === "stuff" || word === "it")) {
    return true;
  }
  return words.length < 12 && GENERIC_DESCRIPTION_PHRASES.some((phrase) => normalized.includes(phrase));
}

export function hasPurposeVerb(words: readonly string[]): boolean {
  return words.some((word) => PURPOSE_VERBS.has(word));
}

export function mentionsInputExpectation(
  description: string,
  inputSchema: KotaToolInputSchema,
): boolean {
  const normalized = description.toLowerCase();
  const requiredFields = inputSchema.required ?? [];
  const propertyNames = schemaPropertyNames(inputSchema);
  return includesMarker(normalized, INPUT_EXPECTATION_MARKERS) ||
    requiredFields.some((field) => normalized.includes(field.toLowerCase())) ||
    propertyNames.some((field) => normalized.includes(field.toLowerCase()));
}

export function mentionsOutputExpectation(description: string): boolean {
  return includesMarker(description.toLowerCase(), OUTPUT_EXPECTATION_MARKERS);
}

export function hasNegativeGuidance(description: string): boolean {
  return includesMarker(description.toLowerCase(), NEGATIVE_GUIDANCE_MARKERS);
}

export function schemaPropertyNames(schema: KotaToolInputSchema): string[] {
  return Object.keys(schema.properties);
}

export function extractExplicitFieldReferences(description: string): string[] {
  const fields: string[] = [];
  const beforePattern = /\b(?:argument|field|input|param|parameter)\s+`([A-Za-z_][A-Za-z0-9_-]*)`/gi;
  const afterPattern = /`([A-Za-z_][A-Za-z0-9_-]*)`\s+(?:argument|field|input|param|parameter)\b/gi;
  for (const pattern of [beforePattern, afterPattern]) {
    let match = pattern.exec(description);
    while (match) {
      fields.push(match[1]);
      match = pattern.exec(description);
    }
  }
  return [...new Set(fields)];
}

function includesMarker(normalizedDescription: string, markers: readonly string[]): boolean {
  return markers.some((marker) => normalizedDescription.includes(marker));
}
