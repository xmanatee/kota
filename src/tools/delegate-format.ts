import type { ToolResult, ToolResultBlock } from "./index.js";

// --- Types ---

export type CompletionReason = "done" | "turn_limit" | "circuit_break" | "context_overflow";

export type DelegateMetadata = {
  mode: string;
  turnsUsed: number;
  turnsMax: number;
  toolsUsed: string[];
  completionReason: CompletionReason;
  urlsFetched: string[];
  searchQueries: string[];
};

// --- Formatting ---

/** Format metadata as a concise single-line prefix for the result. */
export function formatMetadata(meta: DelegateMetadata): string {
  const toolList = meta.toolsUsed.length > 0 ? meta.toolsUsed.join(", ") : "none";
  const parts = [
    `${meta.mode}: ${meta.turnsUsed}/${meta.turnsMax} turns`,
    `tools: ${toolList}`,
  ];
  if (meta.completionReason !== "done") {
    const labels: Record<string, string> = {
      turn_limit: "hit turn limit",
      circuit_break: "stopped: repeated errors",
      context_overflow: "ran out of context",
    };
    parts.push(labels[meta.completionReason] ?? meta.completionReason);
  }
  if (meta.urlsFetched.length > 0) {
    parts.push(`sources: ${meta.urlsFetched.length} URL(s)`);
  }
  if (meta.searchQueries.length > 0) {
    parts.push(`queries: ${meta.searchQueries.length}`);
  }
  return `[${parts.join(" | ")}]`;
}

/** Build a formatted section listing sources consulted during delegation. */
export function buildSourcesSection(
  urls: readonly string[],
  queries: readonly string[],
): string {
  if (urls.length === 0 && queries.length === 0) return "";
  const lines: string[] = [];
  if (urls.length > 0) {
    lines.push(`--- Sources (${urls.length}) ---`);
    for (const u of urls) lines.push(`  ${u}`);
  }
  if (queries.length > 0) {
    lines.push(`--- Search queries (${queries.length}) ---`);
    for (const q of queries) lines.push(`  "${q}"`);
  }
  return "\n\n" + lines.join("\n");
}

/** Build a ToolResult with optional image blocks from delegation. */
export function buildDelegateResult(
  text: string,
  images: ToolResultBlock[],
): ToolResult {
  if (images.length === 0) return { content: text };
  return {
    content: text,
    blocks: [{ type: "text" as const, text }, ...images],
  };
}

/** Collect image blocks from tool results, up to a maximum count. */
export function collectImageBlocks(
  results: Array<{ blocks?: ToolResultBlock[] }>,
  existing: ToolResultBlock[],
  max: number,
): ToolResultBlock[] {
  const collected = [...existing];
  for (const r of results) {
    if (r.blocks) {
      for (const b of r.blocks) {
        if (b.type === "image" && collected.length < max) {
          collected.push(b);
        }
      }
    }
  }
  return collected;
}

// --- File modification tracking ---

/** Extract modified file paths from tool call inputs (and results for find_replace). */
export function extractModifiedFiles(
  toolName: string,
  input: Record<string, unknown>,
  resultContent?: string,
): string[] {
  if (toolName === "file_edit" || toolName === "file_write") {
    const path = input.path as string;
    return path ? [path] : [];
  }
  if (toolName === "multi_edit") {
    const edits = input.edits as Array<{ path?: string; file_path?: string }> | undefined;
    if (!edits) return [];
    return edits
      .map((e) => e.path || e.file_path || "")
      .filter(Boolean);
  }
  if (toolName === "find_replace" && resultContent?.startsWith("Replaced")) {
    const paths: string[] = [];
    for (const line of resultContent.split("\n")) {
      const match = line.match(/^\s{2}(.+):\s+\d+\s+replacement/);
      if (match) paths.push(match[1]);
    }
    return paths;
  }
  return [];
}

// --- Result assembly ---

/** Check if text already contains a sources/references section with URLs. */
export function textHasSources(text: string): boolean {
  if (!text) return false;
  // Look for a heading-like line containing "source" or "reference" (case-insensitive)
  // followed by URLs within the next few lines
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (
      (lower.includes("source") || lower.includes("reference")) &&
      (lower.startsWith("#") || lower.startsWith("-") || lower.startsWith("*") || lower.includes("---"))
    ) {
      // Check if any of the next 10 lines contain a URL
      for (let j = i + 1; j < Math.min(i + 11, lines.length); j++) {
        if (/https?:\/\//.test(lines[j])) return true;
      }
    }
  }
  return false;
}

/** Build sources section, skipping URLs if the sub-agent already included them. */
function buildNonDuplicateSources(
  lastText: string,
  urls: readonly string[],
  queries: readonly string[],
): string {
  if (textHasSources(lastText)) {
    // Sub-agent already included sources — only add search queries if any
    return queries.length > 0
      ? buildSourcesSection([], queries)
      : "";
  }
  return buildSourcesSection(urls, queries);
}

/** Assemble a complete delegation result with metadata, content, sources, and images. */
export function assembleDelegateResult(
  lastText: string,
  meta: DelegateMetadata,
  modifiedFiles: ReadonlySet<string>,
  images: ToolResultBlock[],
): ToolResult {
  const metaLine = formatMetadata(meta);

  if (!lastText && modifiedFiles.size === 0) {
    const sources = buildSourcesSection(meta.urlsFetched, meta.searchQueries);
    return buildDelegateResult(
      `${metaLine}\nSub-agent completed without producing a response.${sources}`,
      images,
    );
  }

  const sources = buildNonDuplicateSources(lastText, meta.urlsFetched, meta.searchQueries);

  if (meta.mode === "execute" && modifiedFiles.size > 0) {
    const fileList = [...modifiedFiles].map((f) => `  - ${f}`).join("\n");
    return buildDelegateResult(
      `${metaLine}\n${lastText || "(no summary)"}\n\n` +
      `--- Modified files (${modifiedFiles.size}) ---\n${fileList}${sources}`,
      images,
    );
  }

  return buildDelegateResult(`${metaLine}\n${lastText || "(no output)"}${sources}`, images);
}
