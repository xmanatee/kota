/**
 * Strict types policy ratchet for production .ts files.
 *
 * Counts raw boundary patterns — `: unknown`, `Record<string, unknown>`, and
 * `as unknown` — per file across `src/` (excluding tests and integration
 * fixtures). Each count is compared to a committed baseline:
 *
 *   - A new file with any boundary count fails the test.
 *   - An existing file's count above its baseline fails the test.
 *   - A reduction below the baseline passes silently; the operator may
 *     regenerate the baseline to ratchet pressure further.
 *   - A file absent from the current scan but present in the baseline is
 *     reported as a stale entry; pass, but the baseline should be trimmed.
 *
 * Regenerate the baseline by running with `STRICT_TYPES_REGENERATE=1`. The
 * regenerator writes the file in canonical sorted order so diffs are clean.
 *
 * Approved boundary directories (where `unknown` is the right type at the
 * edge — JSON parsing, JSON-RPC frames, HTTP responses, SDK adapter input,
 * caught errors, fixture loaders, schema decoders) are documented in the
 * scoped `AGENTS.md` files. The baseline is the mechanical proof.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");
const SRC_DIR = join(REPO_ROOT, "src");
const BASELINE_PATH = join(SRC_DIR, "strict-types-policy-baseline.json");

const PROD_TS = /\.ts$/;
const TEST_TS = /\.(?:test|integration|integration\.test)\.ts$/;

const PATTERNS: readonly RegExp[] = [
  /:\s*unknown\b/g,
  /\bRecord<string,\s*unknown>/g,
  /\bas\s+unknown\b/g,
];

function* walk(dir: string): IterableIterator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (
      entry.isFile() &&
      PROD_TS.test(entry.name) &&
      !TEST_TS.test(entry.name)
    ) {
      yield full;
    }
  }
}

function countBoundaries(content: string): number {
  let total = 0;
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    const matches = content.match(pattern);
    if (matches) total += matches.length;
  }
  return total;
}

function scanCurrent(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const filePath of walk(SRC_DIR)) {
    const content = readFileSync(filePath, "utf8");
    const total = countBoundaries(content);
    if (total > 0) {
      const rel = relative(REPO_ROOT, filePath).replace(/\\/g, "/");
      out[rel] = total;
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function loadBaseline(): Record<string, number> {
  const raw = readFileSync(BASELINE_PATH, "utf8");
  return JSON.parse(raw) as Record<string, number>;
}

describe("strict types policy", () => {
  it("does not regress against the baseline of unknown / Record<string, unknown> usage", () => {
    const current = scanCurrent();

    if (process.env.STRICT_TYPES_REGENERATE === "1") {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
      return;
    }

    const baseline = loadBaseline();

    const newOffenders: string[] = [];
    const regressed: Array<{ file: string; baseline: number; current: number }> = [];
    for (const [file, count] of Object.entries(current)) {
      const baselineCount = baseline[file];
      if (baselineCount === undefined) {
        newOffenders.push(`${file} (count ${count})`);
        continue;
      }
      if (count > baselineCount) {
        regressed.push({ file, baseline: baselineCount, current: count });
      }
    }

    const message: string[] = [];
    if (newOffenders.length > 0) {
      message.push(
        "Files outside the strict-types baseline introduced raw `unknown` / " +
          "`Record<string, unknown>` / `as unknown` usage. Either replace the " +
          "boundary cast with a typed decoder, narrow into a discriminated " +
          "union before reaching domain code, or move the parse to an " +
          "approved boundary file. Files:",
        ...newOffenders.map((s) => `  - ${s}`),
      );
    }
    if (regressed.length > 0) {
      message.push(
        "Existing files exceeded their strict-types baseline (count grew):",
        ...regressed.map((r) => `  - ${r.file}: baseline=${r.baseline}, current=${r.current}`),
      );
    }
    if (message.length > 0) {
      message.push(
        "",
        "If the new usage is justified at a boundary, expand the approved " +
          "boundary directories in scoped AGENTS.md and regenerate via " +
          "STRICT_TYPES_REGENERATE=1 pnpm test src/strict-types-policy.integration.test.ts",
      );
      throw new Error(message.join("\n"));
    }

    expect(newOffenders).toEqual([]);
    expect(regressed).toEqual([]);
  });
});
