import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readWatchlist,
  type WatchlistEntry,
  writeWatchlist,
} from "./watchlist.js";
import {
  classifyWatchlistUpdate,
  type WatchlistClassification,
  type WatchlistFetchOutcome,
} from "./watchlist-classifier.js";

export const WATCHLIST_UPDATES_FILE = "watchlist-updates.json";

export type WatchlistUpdateReport = {
  url: string;
  canonicalUrl?: string;
} & WatchlistFetchOutcome;

export type WatchlistUpdatesPayload = {
  updates: WatchlistUpdateReport[];
};

export type WatchlistApplyResult = {
  url: string;
  classification: WatchlistClassification["kind"] | "canonicalized";
  canonicalUrl?: string;
  skipped?: "unknown-url";
};

function parseUpdatesFile(raw: string): WatchlistUpdatesPayload {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("watchlist-updates.json must be an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.updates)) {
    throw new Error("watchlist-updates.json must have an updates array");
  }
  const updates: WatchlistUpdateReport[] = [];
  for (const raw of obj.updates) {
    if (!raw || typeof raw !== "object") {
      throw new Error("watchlist update must be an object");
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.url !== "string") {
      throw new Error("watchlist update missing url");
    }
    let canonicalUrl: string | undefined;
    if (entry.canonicalUrl !== undefined) {
      if (typeof entry.canonicalUrl !== "string" || entry.canonicalUrl.length === 0) {
        throw new Error(
          `watchlist update for ${entry.url} has invalid canonicalUrl`,
        );
      }
      if (entry.canonicalUrl === entry.url) {
        throw new Error(
          `watchlist update for ${entry.url} has a redundant canonicalUrl`,
        );
      }
      canonicalUrl = entry.canonicalUrl;
    }
    if (entry.accessible === false) {
      if (canonicalUrl !== undefined) {
        throw new Error(
          `watchlist update for ${entry.url} cannot set canonicalUrl when inaccessible`,
        );
      }
      updates.push({ url: entry.url, accessible: false });
      continue;
    }
    if (entry.accessible !== true) {
      throw new Error(
        `watchlist update for ${entry.url} must set accessible: true or false`,
      );
    }
    if (typeof entry.content !== "string" || entry.content.length === 0) {
      throw new Error(
        `watchlist update for ${entry.url} is accessible but missing content`,
      );
    }
    if (typeof entry.summary !== "string" || entry.summary.length === 0) {
      throw new Error(
        `watchlist update for ${entry.url} is accessible but missing summary`,
      );
    }
    updates.push({
      url: entry.url,
      ...(canonicalUrl !== undefined ? { canonicalUrl } : {}),
      accessible: true,
      content: entry.content,
      summary: entry.summary,
    });
  }
  return { updates };
}

function applyClassification(
  entry: WatchlistEntry,
  classification: WatchlistClassification,
  now: string,
): WatchlistEntry {
  switch (classification.kind) {
    case "inaccessible":
      return { ...entry, status: "inaccessible" };
    case "unchanged": {
      if (!entry.snapshot) return entry;
      const next: WatchlistEntry = {
        ...entry,
        snapshot: { ...entry.snapshot, last_seen_at: now },
      };
      delete next.status;
      return next;
    }
    case "new":
    case "changed": {
      const next: WatchlistEntry = {
        ...entry,
        snapshot: {
          fingerprint: classification.fingerprint,
          summary: classification.summary,
          last_seen_at: now,
        },
      };
      delete next.status;
      return next;
    }
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function mergeNotes(...notes: Array<string | undefined>): string | undefined {
  const merged = uniqueStrings(notes.filter((note): note is string => note !== undefined));
  if (merged.length === 0) return undefined;
  return merged.join(" ");
}

function canonicalizationNote(fromUrl: string, toUrl: string, now: string): string {
  return `Canonicalized from ${fromUrl} on ${now} after the fetched resource identified ${toUrl} as the durable project URL.`;
}

function withCanonicalizedFrom(
  entry: WatchlistEntry,
  canonicalizedFrom: string[],
): WatchlistEntry {
  const unique = uniqueStrings(
    canonicalizedFrom.filter((url) => url.length > 0 && url !== entry.url),
  );
  if (unique.length === 0) {
    const next: WatchlistEntry = { ...entry };
    delete next.canonicalizedFrom;
    return next;
  }
  return { ...entry, canonicalizedFrom: unique };
}

function applyCanonicalizedUpdate(
  entries: WatchlistEntry[],
  sourceIndex: number,
  update: WatchlistUpdateReport & {
    accessible: true;
    canonicalUrl: string;
  },
  now: string,
): { entries: WatchlistEntry[]; result: WatchlistApplyResult } {
  const source = entries[sourceIndex];
  const targetIndex = entries.findIndex((entry) => entry.url === update.canonicalUrl);
  const note = canonicalizationNote(source.url, update.canonicalUrl, now);

  if (targetIndex >= 0) {
    const target = entries[targetIndex];
    const canonicalizedTarget = withCanonicalizedFrom(
      {
        ...target,
        notes: mergeNotes(target.notes, source.notes, note),
      },
      [
        ...(target.canonicalizedFrom ?? []),
        ...(source.canonicalizedFrom ?? []),
        source.url,
      ],
    );
    return {
      entries: entries
        .map((entry, index) => (index === targetIndex ? canonicalizedTarget : entry))
        .filter((_entry, index) => index !== sourceIndex),
      result: {
        url: source.url,
        classification: "canonicalized",
        canonicalUrl: update.canonicalUrl,
      },
    };
  }

  const base = withCanonicalizedFrom(
    {
      ...source,
      url: update.canonicalUrl,
      notes: mergeNotes(source.notes, note),
    },
    [...(source.canonicalizedFrom ?? []), source.url],
  );
  const classification = classifyWatchlistUpdate(undefined, update);
  return {
    entries: entries.map((entry, index) =>
      index === sourceIndex ? applyClassification(base, classification, now) : entry,
    ),
    result: {
      url: source.url,
      classification: "canonicalized",
      canonicalUrl: update.canonicalUrl,
    },
  };
}

export type ApplyWatchlistUpdatesOptions = {
  now?: () => string;
};

export function applyWatchlistUpdates(
  projectDir: string,
  payload: WatchlistUpdatesPayload,
  options: ApplyWatchlistUpdatesOptions = {},
): WatchlistApplyResult[] {
  const now = options.now ?? (() => new Date().toISOString());
  const file = readWatchlist(projectDir);
  let entries = file.entries;
  const results: WatchlistApplyResult[] = [];

  for (const update of payload.updates) {
    const entryIndex = entries.findIndex((entry) => entry.url === update.url);
    if (entryIndex < 0) {
      results.push({
        url: update.url,
        classification: "inaccessible",
        skipped: "unknown-url",
      });
      continue;
    }
    const entry = entries[entryIndex];
    const timestamp = now();
    if (update.accessible && update.canonicalUrl !== undefined) {
      const applied = applyCanonicalizedUpdate(
        entries,
        entryIndex,
        { ...update, canonicalUrl: update.canonicalUrl },
        timestamp,
      );
      entries = applied.entries;
      results.push(applied.result);
      continue;
    }
    const classification = classifyWatchlistUpdate(entry.snapshot, update);
    entries = entries.map((candidate, index) =>
      index === entryIndex
        ? applyClassification(candidate, classification, timestamp)
        : candidate,
    );
    results.push({ url: update.url, classification: classification.kind });
  }

  writeWatchlist(projectDir, {
    header: file.header,
    entries,
  });

  return results;
}

export function readWatchlistUpdatesFromRun(
  runDirPath: string,
): WatchlistUpdatesPayload | null {
  const path = join(runDirPath, WATCHLIST_UPDATES_FILE);
  if (!existsSync(path)) return null;
  return parseUpdatesFile(readFileSync(path, "utf-8"));
}

export function checkWatchlistUpdatesCommitMessage(runDirPath: string): string {
  const payload = readWatchlistUpdatesFromRun(runDirPath);
  if (!payload || payload.updates.length === 0) {
    return "OK: no watchlist updates — commit message not required";
  }

  const msgPath = join(runDirPath, "commit-message.txt");
  if (!existsSync(msgPath)) {
    throw new Error(
      `${WATCHLIST_UPDATES_FILE} contains ${payload.updates.length} update(s), ` +
        "so commit-message.txt is required before apply-watchlist-updates mutates data/watchlist.yaml.",
    );
  }
  const content = readFileSync(msgPath, "utf-8").trim();
  if (content.length === 0) {
    throw new Error(
      `${WATCHLIST_UPDATES_FILE} contains ${payload.updates.length} update(s), ` +
        "but commit-message.txt is empty.",
    );
  }
  return `OK: commit-message.txt present for ${payload.updates.length} watchlist update(s)`;
}
