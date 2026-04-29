import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXTERNAL_PATTERN_DECISIONS,
  type ExternalPatternDecision,
  type ExternalPatternVerdict,
} from "./external-pattern-decisions.js";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: import.meta.dirname,
  encoding: "utf-8",
}).trim();

const AGENTS_MD_PATH = join(REPO_ROOT, "src/modules/autonomy/AGENTS.md");
const SECTION_HEADER = "## External Pattern Decisions";
const VERDICTS: readonly ExternalPatternVerdict[] = [
  "adopt",
  "reject",
  "read",
  "defer",
];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function extractCatalogPatterns(): string[] {
  const text = readFileSync(AGENTS_MD_PATH, "utf-8");
  const start = text.indexOf(`\n${SECTION_HEADER}\n`);
  if (start < 0) {
    throw new Error(
      `${AGENTS_MD_PATH} is missing "${SECTION_HEADER}" section header`,
    );
  }
  const after = text.slice(start + SECTION_HEADER.length + 2);
  const nextHeaderIdx = after.search(/\n## /);
  const sectionBody = nextHeaderIdx < 0 ? after : after.slice(0, nextHeaderIdx);

  const labels: string[] = [];
  const bulletLineRe = /^- \*\*([^*]+?)\.\*\*/;
  for (const line of sectionBody.split("\n")) {
    const match = bulletLineRe.exec(line);
    if (!match) continue;
    labels.push(match[1].trim());
  }
  return labels;
}

describe("external pattern decisions sidecar", () => {
  it("declares at least one entry", () => {
    expect(EXTERNAL_PATTERN_DECISIONS.length).toBeGreaterThan(0);
  });

  it("requires every entry to populate every metadata field", () => {
    for (const entry of EXTERNAL_PATTERN_DECISIONS) {
      const where = `entry "${entry.pattern}"`;
      expect(entry.pattern.length, `${where}.pattern empty`).toBeGreaterThan(0);
      expect(VERDICTS, `${where}.verdict invalid`).toContain(entry.verdict);
      expect(entry.source.length, `${where}.source empty`).toBeGreaterThan(0);
      expect(entry.date, `${where}.date not ISO YYYY-MM-DD`).toMatch(ISO_DATE_RE);
      expect(
        entry.kotaPrimitives.length,
        `${where}.kotaPrimitives empty`,
      ).toBeGreaterThan(0);
      for (const prim of entry.kotaPrimitives) {
        expect(prim.length, `${where}.kotaPrimitives has empty entry`).toBeGreaterThan(0);
      }
      expect(entry.revisitWhen.length, `${where}.revisitWhen empty`).toBeGreaterThan(0);
    }
  });

  it("rejects fabricated dates that are not real calendar days", () => {
    for (const entry of EXTERNAL_PATTERN_DECISIONS) {
      const where = `entry "${entry.pattern}"`;
      const parsed = new Date(`${entry.date}T00:00:00Z`);
      expect(Number.isNaN(parsed.getTime()), `${where}.date not parseable`).toBe(false);
      expect(parsed.toISOString().slice(0, 10), `${where}.date roundtrip`).toBe(entry.date);
    }
  });

  it("matches the AGENTS.md catalog 1:1 by pattern label", () => {
    const catalog = extractCatalogPatterns();
    const sidecar = EXTERNAL_PATTERN_DECISIONS.map((d) => d.pattern);
    expect(catalog).toEqual(sidecar);
  });

  it("rejects duplicate pattern labels", () => {
    const seen = new Set<string>();
    for (const entry of EXTERNAL_PATTERN_DECISIONS) {
      expect(seen.has(entry.pattern), `duplicate pattern label: ${entry.pattern}`).toBe(false);
      seen.add(entry.pattern);
    }
  });
});

// Fixture-level guards prove the validation rules actually fail when fields are
// missing or malformed. Future contributors cannot quietly add a new verdict
// without source/date/revisit metadata: these checks would have rejected such
// an entry above when applied to the real catalog.
describe("external pattern decisions field guard", () => {
  function validate(entry: ExternalPatternDecision): string[] {
    const errors: string[] = [];
    if (!entry.pattern.length) errors.push("pattern");
    if (!VERDICTS.includes(entry.verdict)) errors.push("verdict");
    if (!entry.source.length) errors.push("source");
    if (!ISO_DATE_RE.test(entry.date)) errors.push("date-format");
    else {
      const d = new Date(`${entry.date}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== entry.date) {
        errors.push("date-value");
      }
    }
    if (!entry.kotaPrimitives.length) errors.push("kotaPrimitives");
    if (!entry.revisitWhen.length) errors.push("revisitWhen");
    return errors;
  }

  const VALID: ExternalPatternDecision = {
    pattern: "Fixture pattern",
    verdict: "reject",
    source: "fixture-source",
    date: "2026-04-29",
    kotaPrimitives: ["fixture-primitive"],
    revisitWhen: "Fixture revisit condition.",
  };

  it("accepts a fully populated fixture", () => {
    expect(validate(VALID)).toEqual([]);
  });

  it("rejects a fixture missing source", () => {
    expect(validate({ ...VALID, source: "" })).toEqual(["source"]);
  });

  it("rejects a fixture without an ISO date", () => {
    expect(validate({ ...VALID, date: "Q2 2026" })).toEqual(["date-format"]);
  });

  it("rejects a fixture with an impossible calendar date", () => {
    expect(validate({ ...VALID, date: "2026-02-30" })).toEqual(["date-value"]);
  });

  it("rejects a fixture missing revisit condition", () => {
    expect(validate({ ...VALID, revisitWhen: "" })).toEqual(["revisitWhen"]);
  });

  it("rejects a fixture missing KOTA primitives", () => {
    expect(validate({ ...VALID, kotaPrimitives: [] })).toEqual(["kotaPrimitives"]);
  });
});
