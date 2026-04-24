import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyFixtureTemplates,
  substituteFixtureTemplates,
} from "./fixture-templating.js";

describe("substituteFixtureTemplates", () => {
  const NOW = Date.parse("2026-04-24T21:00:00.000Z");

  it("replaces NOW_MINUS_HOURS with a relative ISO timestamp", () => {
    const { output, changed } = substituteFixtureTemplates(
      "started {{NOW_MINUS_HOURS:1}} here",
      NOW,
    );
    expect(changed).toBe(true);
    expect(output).toBe("started 2026-04-24T20:00:00.000Z here");
  });

  it("replaces NOW_MINUS_MINUTES with a relative ISO timestamp", () => {
    const { output, changed } = substituteFixtureTemplates(
      "t={{NOW_MINUS_MINUTES:5}}",
      NOW,
    );
    expect(changed).toBe(true);
    expect(output).toBe("t=2026-04-24T20:55:00.000Z");
  });

  it("substitutes multiple occurrences in one pass", () => {
    const { output, changed } = substituteFixtureTemplates(
      "{{NOW_MINUS_HOURS:2}}..{{NOW_MINUS_HOURS:1}}",
      NOW,
    );
    expect(changed).toBe(true);
    expect(output).toBe("2026-04-24T19:00:00.000Z..2026-04-24T20:00:00.000Z");
  });

  it("reports changed=false and returns input verbatim when nothing matches", () => {
    const input = "plain text with {{UNKNOWN:1}} and no recognized token";
    const { output, changed } = substituteFixtureTemplates(input, NOW);
    expect(changed).toBe(false);
    expect(output).toBe(input);
  });
});

describe("applyFixtureTemplates", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-fixture-tmpl-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("rewrites only files whose content matched and leaves the rest untouched", () => {
    mkdirSync(join(root, "nested"), { recursive: true });
    writeFileSync(
      join(root, "nested", "metadata.json"),
      '{"startedAt":"{{NOW_MINUS_HOURS:1}}"}',
    );
    writeFileSync(join(root, "static.txt"), "nothing dynamic here");

    const nowMs = Date.parse("2026-04-24T21:00:00.000Z");
    applyFixtureTemplates(root, nowMs);

    expect(readFileSync(join(root, "nested", "metadata.json"), "utf-8")).toBe(
      '{"startedAt":"2026-04-24T20:00:00.000Z"}',
    );
    expect(readFileSync(join(root, "static.txt"), "utf-8")).toBe(
      "nothing dynamic here",
    );
  });
});
