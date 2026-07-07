export type SplitFrontMatterResult = {
  frontmatter: string;
  body: string;
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function splitFrontMatter(raw: string): SplitFrontMatterResult | null {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return null;
  return {
    frontmatter: match[1],
    body: match[2],
  };
}

export function parseFlatFrontMatter(raw: string): {
  attrs: Record<string, string | string[]>;
  body: string;
} {
  const split = splitFrontMatter(raw);
  if (!split) return { attrs: {}, body: raw };

  const attrs: Record<string, string | string[]> = {};
  for (const line of split.frontmatter.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = findFlatFrontMatterSeparator(trimmed);
    if (colonIdx < 1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();
    const quotedScalar = parseDoubleQuotedScalar(val);
    if (quotedScalar !== null) {
      attrs[key] = quotedScalar;
    } else if (val.startsWith("[") && val.endsWith("]")) {
      attrs[key] = val
        .slice(1, -1)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    } else {
      attrs[key] = val;
    }
  }

  return { attrs, body: split.body };
}

function parseDoubleQuotedScalar(value: string): string | null {
  if (!value.startsWith("\"") || !value.endsWith("\"")) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function findFlatFrontMatterSeparator(line: string): number {
  let fallbackColon = -1;
  for (let index = 0; index < line.length; index++) {
    if (line[index] !== ":") continue;
    if (fallbackColon < 0) fallbackColon = index;
    const next = line[index + 1];
    if (next === undefined || /\s/.test(next)) return index;
  }
  return fallbackColon;
}

export function isFlatFrontMatterKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.trim() === key &&
    !key.startsWith("#") &&
    !/[\r\n\0]/.test(key) &&
    !/:\s/.test(key)
  );
}

export function serializeFlatFrontMatter(
  attrs: Record<string, string | string[]>,
  body: string,
): string {
  const lines: string[] = ["---"];
  for (const [key, val] of Object.entries(attrs)) {
    if (!isFlatFrontMatterKey(key)) {
      throw new Error(`invalid flat frontmatter key ${JSON.stringify(key)}`);
    }
    if (Array.isArray(val)) {
      lines.push(`${key}: ${serializeFlatFrontMatterArray(val)}`);
    } else {
      lines.push(`${key}: ${serializeFlatFrontMatterScalar(val)}`);
    }
  }
  lines.push("---");
  lines.push(body);
  return lines.join("\n");
}

function serializeFlatFrontMatterScalar(value: string): string {
  if (!needsQuotedFlatFrontMatterScalar(value)) return value;
  return JSON.stringify(value);
}

function serializeFlatFrontMatterArray(values: readonly string[]): string {
  for (const value of values) {
    if (/[\r\n\0]/.test(value)) {
      throw new Error("flat frontmatter array values must not contain CR, LF, or NUL");
    }
  }
  return `[${values.join(", ")}]`;
}

function needsQuotedFlatFrontMatterScalar(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed !== value ||
    /[\r\n\0]/.test(value) ||
    (value.startsWith("[") && value.endsWith("]")) ||
    (value.startsWith("\"") && value.endsWith("\""))
  );
}
