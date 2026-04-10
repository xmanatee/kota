import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { type ConversationRecord, getHistory } from "./core/memory/history.js";
import { getMemoryStore, type Memory } from "./core/memory/store.js";

export type PathInfo = {
  path: string;
  type: "file" | "dir";
  sizeKB: number;
  estimatedLines?: number;
};

export type RequestAnalysis = {
  /** File/directory paths from the message that exist on disk. */
  paths: PathInfo[];
  /** Memories found by searching with extracted key terms. */
  memories: Memory[];
  /** Past conversations matching extracted key terms. */
  conversations: ConversationRecord[];
};

const MAX_PATHS = 5;
const MAX_MEMORIES = 3;
const MAX_CONVERSATIONS = 3;
const MIN_MESSAGE_LENGTH = 20;

/** Common code/config file modules for standalone filename detection. */
const CODE_EXTS =
  "ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|c|cpp|h|hpp|css|scss|html|json|yaml|yml|toml|md|txt|sh|sql|graphql|proto|env|lock|cfg|xml";

/** Patterns to extract file paths from text. */
const PATH_PATTERNS = [
  // Relative paths: ./foo, ../bar/baz.ts
  /(?:^|[\s`"'(])(\.{1,2}\/[\w./-]+)/gm,
  // Paths under common source directories
  /(?:^|[\s`"'(])((?:src|lib|test|tests|app|config|scripts|docs|public|assets|hooks|api|routes|services|models|types)\/[\w./-]+)/gim,
  // Standalone filenames with code modules (dynamic — uses CODE_EXTS)
  new RegExp(
    `(?:^|[\\s\`"'(])([\\w][\\w.-]*\\.(?:${CODE_EXTS}))\\b`,
    "gm",
  ),
];

/** Words too common to be useful as memory search terms. */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "have",
  "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "can", "and", "but", "or", "not", "so", "if", "then", "else",
  "for", "with", "about", "from", "into", "through", "during",
  "before", "after", "above", "below", "between", "this", "that",
  "these", "those", "it", "its", "my", "your", "our", "their",
  "what", "which", "who", "how", "why", "when", "where",
  "all", "each", "every", "both", "few", "more", "most", "some",
  "any", "no", "only", "very", "just", "also", "too", "than",
  "here", "there", "now", "once", "please", "help",
  "want", "need", "like", "make", "let", "try", "get", "use",
  "look", "find", "show", "tell", "know", "think", "see",
  "file", "code", "change", "update", "add", "remove", "fix",
  "new", "old", "first", "last", "next", "other", "same",
]);

/**
 * Extract potential file/directory paths from a message.
 * Returns raw extracted strings — call resolveExistingPaths to verify on disk.
 */
export function extractPaths(message: string): string[] {
  // Strip URLs to avoid false positives like https://example.com/data.json
  const cleaned = message.replace(/https?:\/\/\S+/g, " ");

  const found = new Set<string>();
  for (const pattern of PATH_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(cleaned)) !== null) {
      // Trim trailing punctuation that may have been captured
      const p = match[1].trim().replace(/[`"')\]]+$/, "");
      if (p.length > 1 && p.length < 200) found.add(p);
    }
  }
  return [...found];
}

/**
 * Check which extracted paths actually exist on disk, resolving relative to cwd.
 * Only returns paths that fall within cwd (security boundary).
 */
export function resolveExistingPaths(paths: string[], cwd: string): PathInfo[] {
  const results: PathInfo[] = [];
  for (const p of paths) {
    if (results.length >= MAX_PATHS) break;
    const resolved = isAbsolute(p) ? p : resolve(cwd, p);
    // Security: reject paths outside the working directory
    if (!resolved.startsWith(cwd)) continue;
    try {
      const stat = statSync(resolved);
      const sizeKB = Math.round(stat.size / 1024);
      if (stat.isFile()) {
        results.push({
          path: p,
          type: "file",
          sizeKB,
          estimatedLines: Math.max(1, Math.round(stat.size / 45)),
        });
      } else if (stat.isDirectory()) {
        results.push({ path: p, type: "dir", sizeKB });
      }
    } catch {
      // Doesn't exist — skip
    }
  }
  return results;
}

/**
 * Extract meaningful key terms from a message for memory search.
 * Strips code blocks, URLs, file references, and stop words.
 */
export function extractSearchTerms(message: string): string[] {
  const cleaned = message
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .toLowerCase();

  const words = cleaned
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  return [...new Set(words)].slice(0, 10);
}

/**
 * Analyze a user request and pre-load relevant context.
 * Pure heuristics — zero LLM cost.
 * Returns null if no useful context was found.
 */
export function analyzeRequest(
  message: string,
  cwd: string,
): RequestAnalysis | null {
  if (message.length < MIN_MESSAGE_LENGTH) return null;

  const rawPaths = extractPaths(message);
  const paths = resolveExistingPaths(rawPaths, cwd);

  const terms = extractSearchTerms(message);
  let memories: Memory[] = [];
  let conversations: ConversationRecord[] = [];
  if (terms.length > 0) {
    try {
      const store = getMemoryStore();
      memories = store.search(terms.join(" ")).slice(0, MAX_MEMORIES);
    } catch {
      // Memory store unavailable — skip
    }
    try {
      const history = getHistory();
      conversations = history.list({ search: terms.join(" "), limit: MAX_CONVERSATIONS });
    } catch {
      // History unavailable — skip
    }
  }

  if (paths.length === 0 && memories.length === 0 && conversations.length === 0) return null;
  return { paths, memories, conversations };
}

/**
 * Format analysis results into a compact context hint for appending to the
 * user message. Gives the LLM immediate awareness of referenced files
 * (existence, size) and relevant memories without extra tool calls.
 */
export function formatContextHint(analysis: RequestAnalysis): string {
  const parts: string[] = [];

  if (analysis.paths.length > 0) {
    const descs = analysis.paths.map((p) =>
      p.type === "dir"
        ? `${p.path} (dir)`
        : `${p.path} (~${p.estimatedLines} lines, ${p.sizeKB}KB)`,
    );
    parts.push(`Referenced files: ${descs.join(", ")}`);
  }

  if (analysis.memories.length > 0) {
    const descs = analysis.memories.map((m) => {
      const snippet =
        m.content.length > 100 ? `${m.content.slice(0, 100)}…` : m.content;
      const tags = m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : "";
      return `"${snippet}"${tags}`;
    });
    parts.push(`Recalled: ${descs.join("; ")}`);
  }

  if (analysis.conversations.length > 0) {
    const descs = analysis.conversations.map((c) => {
      const date = c.updatedAt.slice(0, 10);
      return `"${c.title}" (${date}, ${c.messageCount} msgs, id:${c.id})`;
    });
    parts.push(`Related conversations: ${descs.join("; ")}`);
  }

  return `\n\n[Pre-loaded context: ${parts.join(". ")}]`;
}
