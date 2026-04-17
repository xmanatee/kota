import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const WATCHLIST_FILE = "data/watchlist.yaml";

export type WatchlistSnapshot = {
  fingerprint: string;
  summary: string;
  last_seen_at: string;
};

export type WatchlistStatus = "inaccessible";

export type WatchlistEntry = {
  url: string;
  added: string;
  notes?: string;
  status?: WatchlistStatus;
  snapshot?: WatchlistSnapshot;
};

export type WatchlistFile = {
  header: string;
  entries: WatchlistEntry[];
};

const OPERATOR_FIELDS = new Set(["url", "added", "notes", "status"]);
const SNAPSHOT_FIELDS = new Set(["fingerprint", "summary", "last_seen_at"]);

function stripQuotes(raw: string): string {
  const v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function quoteIfNeeded(value: string): string {
  if (value === "") return '""';
  if (/^[A-Za-z0-9._:/\-+@]+$/.test(value) && !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseLine(line: string): { key: string; value: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const key = line.slice(0, colon).trim();
  const value = stripQuotes(line.slice(colon + 1));
  return { key, value };
}

export function parseWatchlist(raw: string): WatchlistFile {
  const lines = raw.split(/\r?\n/);
  let i = 0;
  const headerLines: string[] = [];
  while (i < lines.length && lines[i].trim() !== "resources:") {
    headerLines.push(lines[i]);
    i += 1;
  }
  if (i >= lines.length) {
    return { header: headerLines.join("\n"), entries: [] };
  }
  const header = headerLines.join("\n");
  i += 1;

  type WorkingEntry = {
    url: string;
    added: string;
    notes?: string;
    status?: WatchlistStatus;
    snapshot?: Partial<WatchlistSnapshot>;
  };

  const entries: WatchlistEntry[] = [];
  let current: WorkingEntry | null = null;
  let inSnapshotBlock = false;

  const commit = () => {
    if (!current) return;
    let snapshot: WatchlistSnapshot | undefined;
    if (current.snapshot) {
      const snap = current.snapshot;
      if (
        typeof snap.fingerprint === "string" &&
        typeof snap.summary === "string" &&
        typeof snap.last_seen_at === "string"
      ) {
        snapshot = {
          fingerprint: snap.fingerprint,
          summary: snap.summary,
          last_seen_at: snap.last_seen_at,
        };
      } else {
        throw new Error(
          `watchlist entry ${current.url || "<unknown>"} has an incomplete snapshot block`,
        );
      }
    }
    entries.push({
      url: current.url,
      added: current.added,
      ...(current.notes !== undefined ? { notes: current.notes } : {}),
      ...(current.status !== undefined ? { status: current.status } : {}),
      ...(snapshot !== undefined ? { snapshot } : {}),
    });
    current = null;
    inSnapshotBlock = false;
  };

  for (; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (rawLine.trim() === "") continue;
    if (rawLine.trim().startsWith("#")) continue;

    const listMatch = rawLine.match(/^\s*-\s+(.*)$/);
    if (listMatch) {
      commit();
      const inner = listMatch[1];
      const parsed = parseLine(inner);
      if (!parsed || parsed.key !== "url") {
        throw new Error(`watchlist list item must start with url: got ${rawLine}`);
      }
      current = { url: parsed.value, added: "" };
      inSnapshotBlock = false;
      continue;
    }

    if (!current) {
      throw new Error(`watchlist field outside of entry: ${rawLine}`);
    }

    const parsed = parseLine(rawLine);
    if (!parsed) continue;

    if (parsed.key === "snapshot" && parsed.value === "") {
      inSnapshotBlock = true;
      current.snapshot = current.snapshot ?? {};
      continue;
    }

    const indent = rawLine.length - rawLine.trimStart().length;
    if (inSnapshotBlock && indent >= 6) {
      if (!SNAPSHOT_FIELDS.has(parsed.key)) {
        throw new Error(`unknown snapshot field: ${parsed.key}`);
      }
      const snap = current.snapshot ?? {};
      switch (parsed.key) {
        case "fingerprint":
          snap.fingerprint = parsed.value;
          break;
        case "summary":
          snap.summary = parsed.value;
          break;
        case "last_seen_at":
          snap.last_seen_at = parsed.value;
          break;
      }
      current.snapshot = snap;
      continue;
    }

    inSnapshotBlock = false;
    if (!OPERATOR_FIELDS.has(parsed.key)) {
      throw new Error(`unknown watchlist field: ${parsed.key}`);
    }
    switch (parsed.key) {
      case "url":
        current.url = parsed.value;
        break;
      case "added":
        current.added = parsed.value;
        break;
      case "notes":
        current.notes = parsed.value;
        break;
      case "status":
        if (parsed.value !== "inaccessible") {
          throw new Error(`unknown watchlist status: ${parsed.value}`);
        }
        current.status = parsed.value;
        break;
    }
  }
  commit();

  for (const entry of entries) {
    if (!entry.added) {
      throw new Error(`watchlist entry ${entry.url} missing required field: added`);
    }
  }

  return { header, entries };
}

export function serializeWatchlist(file: WatchlistFile): string {
  const lines: string[] = [];
  if (file.header.length > 0) {
    lines.push(file.header.replace(/\n+$/, ""));
    lines.push("");
  }
  lines.push("resources:");
  for (const entry of file.entries) {
    lines.push(`  - url: ${quoteIfNeeded(entry.url)}`);
    lines.push(`    added: ${quoteIfNeeded(entry.added)}`);
    if (entry.notes !== undefined) {
      lines.push(`    notes: ${quoteIfNeeded(entry.notes)}`);
    }
    if (entry.status !== undefined) {
      lines.push(`    status: ${entry.status}`);
    }
    if (entry.snapshot !== undefined) {
      lines.push("    snapshot:");
      lines.push(`      fingerprint: ${quoteIfNeeded(entry.snapshot.fingerprint)}`);
      lines.push(`      summary: ${quoteIfNeeded(entry.snapshot.summary)}`);
      lines.push(`      last_seen_at: ${quoteIfNeeded(entry.snapshot.last_seen_at)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function readWatchlist(projectDir: string): WatchlistFile {
  const path = join(projectDir, WATCHLIST_FILE);
  if (!existsSync(path)) {
    return { header: "", entries: [] };
  }
  return parseWatchlist(readFileSync(path, "utf-8"));
}

export function writeWatchlist(projectDir: string, file: WatchlistFile): void {
  const path = join(projectDir, WATCHLIST_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeWatchlist(file), "utf-8");
}
