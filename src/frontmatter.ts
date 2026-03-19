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
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
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

export function serializeFlatFrontMatter(
  attrs: Record<string, string | string[]>,
  body: string,
): string {
  const lines: string[] = ["---"];
  for (const [key, val] of Object.entries(attrs)) {
    if (Array.isArray(val)) {
      lines.push(`${key}: [${val.join(", ")}]`);
    } else {
      lines.push(`${key}: ${val}`);
    }
  }
  lines.push("---");
  lines.push(body);
  return lines.join("\n");
}
