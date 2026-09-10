import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { type Document, isMap, isSeq, parseDocument, type YAMLMap } from "yaml";
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

export type WatchlistSnapshot = z.infer<typeof snapshotSchema>;
export type WatchlistStatus = NonNullable<z.infer<typeof entrySchema>["status"]>;
export type WatchlistEntry = Omit<z.infer<typeof entrySchema>, "canonicalized_from"> & {
  canonicalizedFrom?: string[];
};
export type WatchlistFile = {
  readonly header: string;
  entries: WatchlistEntry[];
};

// Formatting belongs to the parsed file, outside its semantic values. Keep that
// file through read/modify/write so YAML comments and scalar styles survive.
const documents = new WeakMap<WatchlistFile, Document.Parsed>();

function parseDocumentChecked(raw: string): Document.Parsed {
  const document = parseDocument(raw);
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) {
    throw new Error(`Invalid watchlist YAML: ${diagnostics.map((error) => error.message).join("; ")}`);
  }
  return document;
}

function decodeEntries(document: Document): WatchlistEntry[] {
  // Aliases cannot be edited independently without changing another source.
  const value: unknown = document.toJS({ maxAliasCount: 0 });
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
  const document = parseDocumentChecked(raw);
  const entries = decodeEntries(document);
  const header = raw.slice(0, document.contents?.range?.[0] ?? 0).trimEnd();
  const file = { header, entries };
  documents.set(file, document);
  return file;
}

function wireEntry({ canonicalizedFrom, ...entry }: WatchlistEntry): z.infer<typeof entrySchema> {
  return {
    ...entry,
    ...(canonicalizedFrom !== undefined ? { canonicalized_from: canonicalizedFrom } : {}),
  };
}

function updateEntry(node: YAMLMap, entry: z.infer<typeof entrySchema>): void {
  for (const key of Object.keys(entrySchema.shape)) {
    const value = entry[key as keyof typeof entry];
    if (value === undefined) {
      node.delete(key);
    } else if (key === "snapshot" && isMap(node.get(key, true)) && entry.snapshot) {
      for (const [field, text] of Object.entries(entry.snapshot)) {
        node.setIn([key, field], text);
      }
    } else if (!isDeepStrictEqual(node.get(key, true)?.toJSON(), value)) {
      node.set(key, value);
    }
  }
}

export function serializeWatchlist(file: WatchlistFile): string {
  const original = documents.get(file);
  const document = original?.clone() ?? parseDocumentChecked(`${file.header}\nresources: []\n`);
  const resources = document.get("resources", true);
  if (!isSeq(resources)) throw new Error("Invalid watchlist: resources must be a sequence");
  const originalEntries = new Map<string, YAMLMap>();
  for (const node of resources.items) {
    if (!isMap(node) || typeof node.get("url") !== "string") {
      throw new Error("Invalid watchlist resource mapping");
    }
    originalEntries.set(node.get("url") as string, node);
  }
  resources.items = file.entries.map((entry) => {
    // A redirect retains the source's comments; merging into an existing target
    // retains that target's document node.
    const previous = originalEntries.get(entry.url) ?? entry.canonicalizedFrom
      ?.map((url) => originalEntries.get(url)).find((node) => node !== undefined);
    const wire = wireEntry(entry);
    if (!previous) return document.createNode(wire);
    const node = previous.clone();
    if (!isMap(node)) throw new Error("Invalid watchlist resource mapping");
    updateEntry(node, wire);
    return node;
  });
  resources.flow = false;
  decodeEntries(document);
  return document.toString({ lineWidth: 0 });
}

export function readWatchlist(workspaceRoot: string): WatchlistFile {
  const path = join(workspaceRoot, WATCHLIST_FILE);
  if (!existsSync(path)) return { header: "", entries: [] };
  return parseWatchlist(readFileSync(path, "utf-8"));
}

export function writeWatchlist(workspaceRoot: string, file: WatchlistFile): void {
  const path = join(workspaceRoot, WATCHLIST_FILE);
  const serialized = serializeWatchlist(file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serialized, "utf-8");
}
