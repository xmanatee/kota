import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  parseWatchlist,
  readWatchlist,
  serializeWatchlist,
  type WatchlistSnapshot,
  writeWatchlist,
} from "./watchlist.js";
import {
  classifyWatchlistUpdate,
  computeWatchlistFingerprint,
  normalizeWatchlistContent,
} from "./watchlist-classifier.js";
import {
  applyWatchlistUpdates,
  readWatchlistUpdatesFromRun,
} from "./watchlist-updates.js";

describe("parseWatchlist / serializeWatchlist", () => {
  it("parses the seed format with only url + added fields", () => {
    const raw = [
      "# header comment",
      "resources:",
      "  - url: https://example.com/a",
      '    added: "2026-04-14"',
      "  - url: https://example.com/b",
      '    added: "2026-04-15"',
      "",
    ].join("\n");

    const file = parseWatchlist(raw);

    expect(file.header).toContain("# header comment");
    expect(file.entries).toEqual([
      { url: "https://example.com/a", added: "2026-04-14" },
      { url: "https://example.com/b", added: "2026-04-15" },
    ]);
  });

  it("round-trips a watchlist with snapshots through parse + serialize", () => {
    const file = {
      header: "# header",
      entries: [
        {
          url: "https://example.com/a",
          added: "2026-04-14",
          canonicalizedFrom: ["https://old.example.com/a"],
          snapshot: {
            fingerprint: "sha256:deadbeef",
            summary: "A project",
            last_seen_at: "2026-04-17T10:00:00.000Z",
          },
        },
        {
          url: "https://example.com/b",
          added: "2026-04-14",
          status: "inaccessible" as const,
        },
      ],
    };

    const serialized = serializeWatchlist(file);
    const parsed = parseWatchlist(serialized);

    expect(parsed.entries).toEqual(file.entries);
    expect(serialized).toContain("canonicalized_from:");
    expect(serialized).toContain("https://old.example.com/a");
  });

  it("rejects a snapshot block missing required fields", () => {
    const raw = [
      "resources:",
      "  - url: https://example.com/a",
      '    added: "2026-04-14"',
      "    snapshot:",
      "      fingerprint: abc",
      "",
    ].join("\n");

    expect(() => parseWatchlist(raw)).toThrow(/incomplete snapshot/);
  });

  it("rejects unknown top-level fields", () => {
    const raw = [
      "resources:",
      "  - url: https://example.com/a",
      '    added: "2026-04-14"',
      "    mystery: value",
      "",
    ].join("\n");

    expect(() => parseWatchlist(raw)).toThrow(/unknown watchlist field/);
  });

  it("rejects canonicalized aliases that remain listed as refresh resources", () => {
    const raw = [
      "resources:",
      "  - url: https://example.com/current",
      '    added: "2026-04-14"',
      "    canonicalized_from:",
      "      - https://example.com/old",
      "  - url: https://example.com/old",
      '    added: "2026-04-14"',
      "",
    ].join("\n");

    expect(() => parseWatchlist(raw)).toThrow(/still listed as a resource/);
  });
});

describe("normalizeWatchlistContent", () => {
  it("is stable across trivial whitespace churn", () => {
    const a = normalizeWatchlistContent("Hello   World\nFoo\tBar");
    const b = normalizeWatchlistContent("hello world foo bar");
    expect(a).toBe(b);
  });

  it("strips ISO date timestamps", () => {
    const a = normalizeWatchlistContent(
      "Updated 2026-04-17T10:15:32.123Z and ready to ship.",
    );
    const b = normalizeWatchlistContent(
      "Updated 2026-04-18T11:22:33Z and ready to ship.",
    );
    expect(a).toBe(b);
  });

  it("strips relative time churn", () => {
    const a = normalizeWatchlistContent("pushed 2 hours ago by user");
    const b = normalizeWatchlistContent("pushed 5 hours ago by user");
    expect(a).toBe(b);
  });

  it("produces different output for genuinely different content", () => {
    const a = normalizeWatchlistContent("An autonomous agent for dev");
    const b = normalizeWatchlistContent("A CLI tool for git operations");
    expect(a).not.toBe(b);
  });
});

describe("classifyWatchlistUpdate", () => {
  it("returns inaccessible when the outcome is inaccessible", () => {
    const result = classifyWatchlistUpdate(undefined, { accessible: false });
    expect(result.kind).toBe("inaccessible");
  });

  it("returns new when there is no prior snapshot", () => {
    const result = classifyWatchlistUpdate(undefined, {
      accessible: true,
      content: "First look at the repo.",
      summary: "A repo",
    });
    expect(result.kind).toBe("new");
    if (result.kind === "new") {
      expect(result.fingerprint).toMatch(/^sha256:/);
      expect(result.summary).toBe("A repo");
    }
  });

  it("returns unchanged when the fingerprint matches", () => {
    const content = "Some stable content.";
    const normalized = normalizeWatchlistContent(content);
    const previous: WatchlistSnapshot = {
      fingerprint: computeWatchlistFingerprint(normalized),
      summary: "Stable",
      last_seen_at: "2026-04-17T00:00:00.000Z",
    };
    const result = classifyWatchlistUpdate(previous, {
      accessible: true,
      content,
      summary: "Stable",
    });
    expect(result.kind).toBe("unchanged");
  });

  it("treats trivial date-only churn as unchanged", () => {
    const a = "Release notes. Updated 2026-04-17T10:00:00Z.";
    const b = "Release notes. Updated 2026-04-18T11:30:00Z.";
    const previous: WatchlistSnapshot = {
      fingerprint: computeWatchlistFingerprint(normalizeWatchlistContent(a)),
      summary: "Notes",
      last_seen_at: "2026-04-17T00:00:00.000Z",
    };
    const result = classifyWatchlistUpdate(previous, {
      accessible: true,
      content: b,
      summary: "Notes",
    });
    expect(result.kind).toBe("unchanged");
  });

  it("returns changed when content has meaningfully shifted", () => {
    const previous: WatchlistSnapshot = {
      fingerprint: computeWatchlistFingerprint(
        normalizeWatchlistContent("A lightweight README."),
      ),
      summary: "Old",
      last_seen_at: "2026-04-17T00:00:00.000Z",
    };
    const result = classifyWatchlistUpdate(previous, {
      accessible: true,
      content: "A full redesign with new architecture.",
      summary: "New",
    });
    expect(result.kind).toBe("changed");
    if (result.kind === "changed") {
      expect(result.previousFingerprint).toBe(previous.fingerprint);
      expect(result.summary).toBe("New");
    }
  });
});

describe("applyWatchlistUpdates", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "watchlist-test-"));
  });

  function seed(raw: string): void {
    const path = join(tempDir, "data", "watchlist.yaml");
    mkdirSync(join(tempDir, "data"), { recursive: true });
    writeFileSync(path, raw, "utf-8");
  }

  it("writes a snapshot for a newly-seen entry", () => {
    seed(
      [
        "resources:",
        "  - url: https://example.com/a",
        '    added: "2026-04-14"',
        "",
      ].join("\n"),
    );

    const results = applyWatchlistUpdates(
      tempDir,
      {
        updates: [
          {
            url: "https://example.com/a",
            accessible: true,
            content: "First view.",
            summary: "First summary.",
          },
        ],
      },
      { now: () => "2026-04-17T00:00:00.000Z" },
    );

    expect(results).toEqual([
      { url: "https://example.com/a", classification: "new" },
    ]);
    const after = readWatchlist(tempDir);
    expect(after.entries[0].snapshot).toEqual({
      fingerprint: expect.stringMatching(/^sha256:/),
      summary: "First summary.",
      last_seen_at: "2026-04-17T00:00:00.000Z",
    });
  });

  it("marks inaccessible entries with status: inaccessible", () => {
    seed(
      [
        "resources:",
        "  - url: https://example.com/a",
        '    added: "2026-04-14"',
        "",
      ].join("\n"),
    );

    const results = applyWatchlistUpdates(tempDir, {
      updates: [{ url: "https://example.com/a", accessible: false }],
    });

    expect(results[0].classification).toBe("inaccessible");
    const after = readWatchlist(tempDir);
    expect(after.entries[0].status).toBe("inaccessible");
    expect(after.entries[0].snapshot).toBeUndefined();
  });

  it("clears inaccessible status when an entry becomes reachable again", () => {
    seed(
      [
        "resources:",
        "  - url: https://example.com/a",
        '    added: "2026-04-14"',
        "    status: inaccessible",
        "",
      ].join("\n"),
    );

    applyWatchlistUpdates(
      tempDir,
      {
        updates: [
          {
            url: "https://example.com/a",
            accessible: true,
            content: "Back online.",
            summary: "Reachable again.",
          },
        ],
      },
      { now: () => "2026-04-17T00:00:00.000Z" },
    );

    const after = readWatchlist(tempDir);
    expect(after.entries[0].status).toBeUndefined();
    expect(after.entries[0].snapshot?.summary).toBe("Reachable again.");
  });

  it("refreshes last_seen_at but not fingerprint when unchanged", () => {
    const content = "Steady content.";
    const normalized = normalizeWatchlistContent(content);
    const fingerprint = computeWatchlistFingerprint(normalized);

    writeWatchlist(tempDir, {
      header: "",
      entries: [
        {
          url: "https://example.com/a",
          added: "2026-04-14",
          snapshot: {
            fingerprint,
            summary: "Old summary.",
            last_seen_at: "2026-04-16T00:00:00.000Z",
          },
        },
      ],
    });

    applyWatchlistUpdates(
      tempDir,
      {
        updates: [
          {
            url: "https://example.com/a",
            accessible: true,
            content,
            summary: "New summary — ignored on unchanged.",
          },
        ],
      },
      { now: () => "2026-04-17T00:00:00.000Z" },
    );

    const after = readWatchlist(tempDir);
    expect(after.entries[0].snapshot).toEqual({
      fingerprint,
      summary: "Old summary.",
      last_seen_at: "2026-04-17T00:00:00.000Z",
    });
  });

  it("canonicalizes a redirect-only repository entry to a new target", () => {
    const content = "Pi repository content at the current canonical URL.";
    const oldAliasFingerprint = computeWatchlistFingerprint(
      normalizeWatchlistContent(content),
    );
    seed(
      [
        "resources:",
        "  - url: https://github.com/badlogic/pi-mono",
        '    added: "2026-04-14"',
        "    snapshot:",
        `      fingerprint: ${oldAliasFingerprint}`,
        '      summary: "Old Pi alias."',
        '      last_seen_at: "2026-05-01T00:00:00.000Z"',
        "",
      ].join("\n"),
    );

    const results = applyWatchlistUpdates(
      tempDir,
      {
        updates: [
          {
            url: "https://github.com/badlogic/pi-mono",
            canonicalUrl: "https://github.com/earendil-works/pi",
            accessible: true,
            content,
            summary: "Pi repository under its current canonical URL.",
          },
        ],
      },
      { now: () => "2026-05-27T12:00:00.000Z" },
    );

    expect(results).toEqual([
      {
        url: "https://github.com/badlogic/pi-mono",
        classification: "canonicalized",
        canonicalUrl: "https://github.com/earendil-works/pi",
      },
    ]);
    const after = readWatchlist(tempDir);
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0]).toMatchObject({
      url: "https://github.com/earendil-works/pi",
      added: "2026-04-14",
      canonicalizedFrom: ["https://github.com/badlogic/pi-mono"],
      snapshot: {
        fingerprint: expect.stringMatching(/^sha256:/),
        summary: "Pi repository under its current canonical URL.",
        last_seen_at: "2026-05-27T12:00:00.000Z",
      },
    });
    expect(after.entries[0].notes).toContain(
      "Canonicalized from https://github.com/badlogic/pi-mono",
    );
  });

  it("canonicalizes a moved-project pointer to an already tracked target", () => {
    writeWatchlist(tempDir, {
      header: "",
      entries: [
        {
          url: "https://github.com/mannaandpoem/OpenManus",
          added: "2026-04-19",
          notes: "Old owner URL.",
          snapshot: {
            fingerprint: "sha256:pointer",
            summary: "Moved to FoundationAgents/OpenManus.",
            last_seen_at: "2026-05-26T00:00:00.000Z",
          },
        },
        {
          url: "https://github.com/FoundationAgents/OpenManus",
          added: "2026-04-20",
          snapshot: {
            fingerprint: "sha256:canonical",
            summary: "Canonical OpenManus project.",
            last_seen_at: "2026-05-18T00:00:00.000Z",
          },
        },
      ],
    });

    applyWatchlistUpdates(
      tempDir,
      {
        updates: [
          {
            url: "https://github.com/mannaandpoem/OpenManus",
            canonicalUrl: "https://github.com/FoundationAgents/OpenManus",
            accessible: true,
            content: "This project has moved to FoundationAgents/OpenManus.",
            summary: "Moved-project pointer.",
          },
        ],
      },
      { now: () => "2026-05-27T12:00:00.000Z" },
    );

    const after = readWatchlist(tempDir);
    expect(after.entries.map((entry) => entry.url)).toEqual([
      "https://github.com/FoundationAgents/OpenManus",
    ]);
    expect(after.entries[0]).toMatchObject({
      canonicalizedFrom: ["https://github.com/mannaandpoem/OpenManus"],
      notes: expect.stringContaining("Old owner URL."),
      snapshot: {
        fingerprint: "sha256:canonical",
        summary: "Canonical OpenManus project.",
        last_seen_at: "2026-05-18T00:00:00.000Z",
      },
    });
  });

  it("removes duplicate entries when a redirect target is already tracked", () => {
    writeWatchlist(tempDir, {
      header: "",
      entries: [
        {
          url: "https://github.com/block/goose",
          added: "2026-04-19",
        },
        {
          url: "https://github.com/aaif-goose/goose",
          added: "2026-05-01",
          canonicalizedFrom: ["https://old.example.com/goose"],
          snapshot: {
            fingerprint: "sha256:goose",
            summary: "Canonical goose project.",
            last_seen_at: "2026-05-20T00:00:00.000Z",
          },
        },
      ],
    });

    applyWatchlistUpdates(
      tempDir,
      {
        updates: [
          {
            url: "https://github.com/block/goose",
            canonicalUrl: "https://github.com/aaif-goose/goose",
            accessible: true,
            content: "Goose repository content.",
            summary: "Goose moved to AAIF.",
          },
        ],
      },
      { now: () => "2026-05-27T12:00:00.000Z" },
    );

    const after = readWatchlist(tempDir);
    expect(after.entries.map((entry) => entry.url)).toEqual([
      "https://github.com/aaif-goose/goose",
    ]);
    expect(after.entries[0].canonicalizedFrom).toEqual([
      "https://old.example.com/goose",
      "https://github.com/block/goose",
    ]);
  });

  it("skips unknown URLs without mutating the rest of the file", () => {
    const original = [
      "resources:",
      "  - url: https://example.com/a",
      '    added: "2026-04-14"',
      "",
    ].join("\n");
    seed(original);

    const results = applyWatchlistUpdates(tempDir, {
      updates: [{ url: "https://other.example.com", accessible: false }],
    });

    expect(results[0].skipped).toBe("unknown-url");
    const after = readFileSync(
      join(tempDir, "data", "watchlist.yaml"),
      "utf-8",
    );
    // Should reserialize cleanly but preserve entries.
    expect(after).toContain("https://example.com/a");
    expect(after).not.toContain("https://other.example.com");
  });
});

describe("readWatchlistUpdatesFromRun", () => {
  it("returns null when the file is absent", () => {
    const runDir = mkdtempSync(join(tmpdir(), "watchlist-run-"));
    expect(readWatchlistUpdatesFromRun(runDir)).toBeNull();
  });

  it("parses a valid updates file", () => {
    const runDir = mkdtempSync(join(tmpdir(), "watchlist-run-"));
    writeFileSync(
      join(runDir, "watchlist-updates.json"),
      JSON.stringify({
        updates: [
          {
            url: "https://example.com/a",
            accessible: true,
            content: "x",
            summary: "y",
          },
        ],
      }),
      "utf-8",
    );
    const payload = readWatchlistUpdatesFromRun(runDir);
    expect(payload?.updates).toHaveLength(1);
    expect(payload?.updates[0]).toMatchObject({
      url: "https://example.com/a",
      accessible: true,
    });
  });

  it("rejects an accessible update missing content", () => {
    const runDir = mkdtempSync(join(tmpdir(), "watchlist-run-"));
    writeFileSync(
      join(runDir, "watchlist-updates.json"),
      JSON.stringify({
        updates: [
          { url: "https://example.com/a", accessible: true, summary: "y" },
        ],
      }),
      "utf-8",
    );
    expect(() => readWatchlistUpdatesFromRun(runDir)).toThrow(/missing content/);
  });
});
