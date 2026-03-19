/** Safely parse a numeric input, returning the default for null/undefined/NaN/negative. */
export function safePositiveInt(value: unknown, fallback: number, max?: number): number {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const result = Math.round(n);
  return max != null ? Math.min(result, max) : result;
}

export function formatResult(status: number, statusText: string, headers: string, body: string): string {
  return `HTTP ${status} ${statusText}\n${headers}\n${body}`;
}

/** Format selected response headers as compact lines */
export function formatResponseHeaders(headers: Headers): string {
  const interesting = [
    "content-type", "content-length", "location", "set-cookie",
    "x-request-id", "x-ratelimit-remaining", "x-ratelimit-limit",
    "x-ratelimit-reset", "retry-after", "www-authenticate", "allow",
    "link",
  ];
  const lines: string[] = [];
  for (const name of interesting) {
    const value = headers.get(name);
    if (value) {
      lines.push(`${name}: ${value}`);
    }
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function isBinaryContentType(ct: string): boolean {
  if (!ct) return false;
  return (
    ct.startsWith("image/") ||
    ct.startsWith("audio/") ||
    ct.startsWith("video/") ||
    ct.includes("octet-stream") ||
    ct.includes("pdf") ||
    ct.includes("zip") ||
    ct.includes("gzip") ||
    ct.includes("tar")
  );
}

/** Detect abort/timeout errors reliably across Node versions. */
export function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

export function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const MAX_TABLE_ROWS = 50;
const MAX_TABLE_COLS = 10;

/**
 * Format an array of objects as a compact markdown table.
 * Returns null if the data is not suitable for tabular display.
 */
export function formatTabularJson(data: unknown): string | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  // All elements must be plain objects with at least one key
  const rows = data as Record<string, unknown>[];
  if (!rows.every(r => r !== null && typeof r === "object" && !Array.isArray(r) && Object.keys(r).length > 0)) {
    return null;
  }

  // Collect all unique keys in insertion order
  const keySet = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) keySet.add(k);
  }
  let cols = Array.from(keySet);
  const truncCols = cols.length > MAX_TABLE_COLS;
  if (truncCols) cols = cols.slice(0, MAX_TABLE_COLS);

  // Only tabulate if values are scalar (string, number, boolean, null)
  for (const row of rows) {
    for (const c of cols) {
      const v = row[c];
      if (v !== null && v !== undefined && typeof v === "object") return null;
    }
  }

  const displayRows = rows.slice(0, MAX_TABLE_ROWS);
  const truncRows = rows.length > MAX_TABLE_ROWS;

  // Escape markdown-breaking chars in cell values
  const fmtCell = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

  // Compute column widths from escaped values
  const widths = cols.map(c =>
    Math.max(c.length, ...displayRows.map(r => fmtCell(r[c]).length)),
  );

  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const header = `| ${cols.map((c, i) => pad(c, widths[i])).join(" | ")} |`;
  const sep = `| ${widths.map(w => "-".repeat(w)).join(" | ")} |`;
  const body = displayRows.map(
    r => `| ${cols.map((c, i) => pad(fmtCell(r[c]), widths[i])).join(" | ")} |`,
  );

  let result = [header, sep, ...body].join("\n");
  const notes: string[] = [];
  if (truncRows) notes.push(`showing ${MAX_TABLE_ROWS} of ${rows.length} rows`);
  if (truncCols) notes.push(`showing ${MAX_TABLE_COLS} of ${keySet.size} columns`);
  if (notes.length > 0) result += `\n[${notes.join("; ")}]`;
  return result;
}
