/**
 * JSON structural preview for file_read.
 * For JSON files, provides schema overview (keys, types, array lengths,
 * sample values) so the agent can understand structure without reading
 * the entire file. Mirrors csv-preview.ts pattern.
 */

export const JSON_EXTENSIONS = new Set([".json", ".jsonl", ".ndjson"]);

/** Describe the type/shape of a JSON value concisely. */
function describeValue(val: unknown, depth: number): string {
  if (val === null) return "null";
  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    const itemDesc = depth < 2 ? describeValue(val[0], depth + 1) : "...";
    return `Array(${val.length})[${itemDesc}]`;
  }
  if (typeof val === "object") {
    const keys = Object.keys(val as Record<string, unknown>);
    if (keys.length === 0) return "{}";
    if (depth >= 2) return `{${keys.length} keys}`;
    const preview = keys.slice(0, 6).map((k) => {
      const child = (val as Record<string, unknown>)[k];
      return `${k}: ${describeValue(child, depth + 1)}`;
    });
    const suffix = keys.length > 6 ? `, ...+${keys.length - 6}` : "";
    return `{ ${preview.join(", ")}${suffix} }`;
  }
  if (typeof val === "string") {
    return val.length > 40 ? `string(${val.length})` : `"${val}"`;
  }
  return String(val);
}

/** Summarize top-level array: show element shape from first few items. */
function summarizeArray(arr: unknown[]): string {
  const lines: string[] = [`Array with ${arr.length} elements`];
  if (arr.length === 0) return lines[0];

  // Check if elements are uniform objects
  const objects = arr.filter((x) => x !== null && typeof x === "object" && !Array.isArray(x));
  if (objects.length > arr.length * 0.8) {
    // Mostly objects — show unified key set with types from sample
    const keyCounts = new Map<string, number>();
    const keyTypes = new Map<string, Set<string>>();
    const sample = objects.slice(0, 20) as Record<string, unknown>[];
    for (const obj of sample) {
      for (const [k, v] of Object.entries(obj)) {
        keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
        if (!keyTypes.has(k)) keyTypes.set(k, new Set());
        keyTypes.get(k)!.add(v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
      }
    }
    const fields = [...keyCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([k]) => {
        const types = [...keyTypes.get(k)!].join("|");
        return `  ${k}: ${types}`;
      });
    lines.push("Element schema (from first 20):");
    lines.push(...fields);
    if (keyCounts.size > 12) {
      lines.push(`  ...+${keyCounts.size - 12} more keys`);
    }
  } else {
    // Mixed types — show first few
    const sample = arr.slice(0, 3);
    lines.push("Sample elements:");
    for (const item of sample) {
      lines.push(`  ${describeValue(item, 0)}`);
    }
  }
  return lines.join("\n");
}

/** Summarize a top-level object. */
function summarizeObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj);
  const lines: string[] = [`Object with ${keys.length} keys`];
  const shown = keys.slice(0, 15);
  for (const k of shown) {
    lines.push(`  ${k}: ${describeValue(obj[k], 1)}`);
  }
  if (keys.length > 15) {
    lines.push(`  ...+${keys.length - 15} more keys`);
  }
  return lines.join("\n");
}

/**
 * Format a JSON structural preview header.
 * Returns empty string if parsing fails (caller falls through to text).
 */
export function formatJsonPreview(content: string, filePath: string): string {
  const ext = filePath.toLowerCase();
  const isJsonl = ext.endsWith(".jsonl") || ext.endsWith(".ndjson");

  if (isJsonl) {
    return formatJsonlPreview(content);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return ""; // Not valid JSON — fall through to plain text display
  }

  if (parsed === null || typeof parsed !== "object") {
    return `[JSON: scalar ${describeValue(parsed, 0)}]\n\n`;
  }

  if (Array.isArray(parsed)) {
    return `[JSON: ${summarizeArray(parsed)}]\n\n`;
  }

  return `[JSON: ${summarizeObject(parsed as Record<string, unknown>)}]\n\n`;
}

/** Preview JSONL/NDJSON: parse first few lines, show schema. */
function formatJsonlPreview(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim());
  const total = lines.length;
  if (total === 0) return "";

  const sample: unknown[] = [];
  for (const line of lines.slice(0, 20)) {
    try {
      sample.push(JSON.parse(line));
    } catch {
      // Skip unparseable lines
    }
  }
  if (sample.length === 0) return "";

  const summary = summarizeArray(sample);
  return `[JSONL: ${total} lines | ${summary}]\n\n`;
}
