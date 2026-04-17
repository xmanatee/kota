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

export type WatchlistUpdateReport = { url: string } & WatchlistFetchOutcome;

export type WatchlistUpdatesPayload = {
  updates: WatchlistUpdateReport[];
};

export type WatchlistApplyResult = {
  url: string;
  classification: WatchlistClassification["kind"];
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
    if (entry.accessible === false) {
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
  const byUrl = new Map(file.entries.map((e) => [e.url, e]));
  const results: WatchlistApplyResult[] = [];

  for (const update of payload.updates) {
    const entry = byUrl.get(update.url);
    if (!entry) {
      results.push({
        url: update.url,
        classification: "inaccessible",
        skipped: "unknown-url",
      });
      continue;
    }
    const classification = classifyWatchlistUpdate(entry.snapshot, update);
    const updated = applyClassification(entry, classification, now());
    byUrl.set(update.url, updated);
    results.push({ url: update.url, classification: classification.kind });
  }

  writeWatchlist(projectDir, {
    header: file.header,
    entries: file.entries.map((e) => byUrl.get(e.url) ?? e),
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
