import { basename } from "node:path";
import { globSync } from "glob";

const IGNORE_DIRS = [
  "node_modules/**",
  "dist/**",
  ".git/**",
  ".next/**",
  "build/**",
  "coverage/**",
  ".cache/**",
];

/**
 * When a path doesn't exist, suggest alternatives by searching
 * for files with the same or similar basename.
 * Returns at most `max` suggestions, sorted by relevance.
 */
export function suggestAlternatives(missingPath: string, max = 5): string[] {
  const name = basename(missingPath);
  if (!name) return [];

  // Try exact filename match first (most common case: right name, wrong directory)
  try {
    const exact = globSync(`**/${escapeGlob(name)}`, {
      ignore: IGNORE_DIRS,
      maxDepth: 10,
      nodir: true,
    });
    if (exact.length > 0) {
      return exact.slice(0, max);
    }
  } catch {
    return [];
  }

  // If no exact match, try fuzzy: same module, score by name similarity
  const ext = getExtension(name);
  if (!ext) return [];

  try {
    const candidates = globSync(`**/*${ext}`, {
      ignore: IGNORE_DIRS,
      maxDepth: 8,
      nodir: true,
    });

    return candidates
      .map((p) => ({ path: p, score: nameSimilarity(name, basename(p)) }))
      .filter((s) => s.score > 0.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((s) => s.path);
  } catch {
    return [];
  }
}

/** Extract file module including the dot. Returns "" if none. */
function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot) : "";
}

/** Escape special glob characters in a filename. */
function escapeGlob(s: string): string {
  return s.replace(/[[\]{}()*?!\\]/g, "\\$&");
}

/**
 * Bigram (Dice coefficient) similarity between two strings.
 * Returns 0-1 where 1 is exact match. Case-insensitive.
 */
export function nameSimilarity(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return 1;
  if (la.length < 2 || lb.length < 2) return 0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < la.length - 1; i++) {
    const bi = la.slice(i, i + 2);
    bigramsA.set(bi, (bigramsA.get(bi) || 0) + 1);
  }

  let overlap = 0;
  for (let i = 0; i < lb.length - 1; i++) {
    const bi = lb.slice(i, i + 2);
    const count = bigramsA.get(bi) || 0;
    if (count > 0) {
      bigramsA.set(bi, count - 1);
      overlap++;
    }
  }

  return (2 * overlap) / (la.length - 1 + lb.length - 1);
}

/**
 * Format a "file not found" error with path suggestions.
 * The glob search runs only on miss — zero cost for existing files.
 */
export function fileNotFoundError(path: string): string {
  const suggestions = suggestAlternatives(path);
  const base = `Error: file not found: ${path}`;

  if (suggestions.length === 0) return base;

  if (suggestions.length === 1) {
    return `${base}\n\nDid you mean: ${suggestions[0]}`;
  }

  return `${base}\n\nSimilar files found:\n${suggestions.map((s) => `  - ${s}`).join("\n")}`;
}
