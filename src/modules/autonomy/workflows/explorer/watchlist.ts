import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Document, parseDocument } from "yaml";
import { z } from "zod";

export const WATCHLIST_FILE = "data/watchlist.yaml";

const snapshotSchema = z.strictObject({
  fingerprint: z.string(),
  summary: z.string(),
  last_seen_at: z.string().min(1),
});
const entrySchema = z.strictObject({
  url: z.string().min(1),
  added: z.string().min(1),
  canonicalized_from: z.array(z.string()).optional(),
  notes: z.string().optional(),
  status: z.literal("inaccessible").optional(),
  snapshot: snapshotSchema.optional(),
});
const fileSchema = z.strictObject({ resources: z.array(entrySchema) });

export type WatchlistEntry = Omit<z.infer<typeof entrySchema>, "canonicalized_from"> & {
  canonicalizedFrom?: string[];
};
export type WatchlistFile = {
  entries: WatchlistEntry[];
};

function parseDocumentChecked(raw: string): Document.Parsed {
  const document = parseDocument(raw);
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) {
    throw new Error(`Invalid watchlist YAML: ${diagnostics.map((error) => error.message).join("; ")}`);
  }
  return document;
}

function decodeEntries(document: Document): WatchlistEntry[] {
  const value: unknown = document.toJS();
  const result = fileSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid watchlist: ${result.error.issues.map((issue) =>
      `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  const entries = result.data.resources.map(({ canonicalized_from, ...entry }) => ({
    ...entry,
    ...(canonicalized_from !== undefined ? { canonicalizedFrom: canonicalized_from } : {}),
  }));
  const entryUrls = new Set<string>();
  for (const entry of entries) {
    if (entryUrls.has(entry.url)) {
      throw new Error(`duplicate watchlist entry url: ${entry.url}`);
    }
    entryUrls.add(entry.url);
  }
  const canonicalizedFromUrls = new Map<string, string>();
  for (const entry of entries) {
    for (const oldUrl of entry.canonicalizedFrom ?? []) {
      if (oldUrl.length === 0) {
        throw new Error(`watchlist entry ${entry.url} has empty canonicalized_from url`);
      }
      if (oldUrl === entry.url) {
        throw new Error(
          `watchlist entry ${entry.url} cannot canonicalize from itself`,
        );
      }
      if (entryUrls.has(oldUrl)) {
        throw new Error(
          `watchlist canonicalized_from ${oldUrl} is still listed as a resource`,
        );
      }
      const existing = canonicalizedFromUrls.get(oldUrl);
      if (existing !== undefined) {
        throw new Error(
          `watchlist canonicalized_from ${oldUrl} appears on both ${existing} and ${entry.url}`,
        );
      }
      canonicalizedFromUrls.set(oldUrl, entry.url);
    }
  }

  return entries;
}

export function parseWatchlist(raw: string): WatchlistFile {
  return { entries: decodeEntries(parseDocumentChecked(raw)) };
}

export function readWatchlist(workspaceRoot: string): WatchlistFile {
  const path = join(workspaceRoot, WATCHLIST_FILE);
  if (!existsSync(path)) return { entries: [] };
  return parseWatchlist(readFileSync(path, "utf-8"));
}
