function replaceControlCharacters(value: string, preserveLineFeeds: boolean): string {
  let normalized = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    const replace = (code <= 0x1f || code === 0x7f) &&
      !(preserveLineFeeds && code === 0x0a);
    normalized += replace ? " " : character;
  }
  return normalized;
}

export function normalizeGeneratedTaskScalar(
  source: string,
  field: string,
  value: string,
): string {
  const normalized = replaceControlCharacters(value, false)
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    throw new Error(`${source} ${field} is empty after normalization`);
  }
  return normalized;
}

const BODY_LINE_TERMINATOR_PATTERN = /\r\n?|[\n\u2028\u2029]/g;

export function renderGeneratedTaskProse(value: string): string {
  const normalizedLineEndings = value.replace(BODY_LINE_TERMINATOR_PATTERN, "\n").trim();
  const normalized = replaceControlCharacters(normalizedLineEndings, true).trim();
  if (!normalized) throw new Error("generated task prose is empty after normalization");
  return normalized
    .split("\n")
    .map((line) => `    ${line.trimEnd()}`)
    .join("\n");
}
