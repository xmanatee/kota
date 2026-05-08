/**
 * Import guard: no production `.ts` file may default to a literal vendor
 * model id (`claude-(opus|sonnet|haiku)-N`, `gpt-N`, `gemini-N`). Every
 * default flows through the active `Preset` (see `src/core/model/preset.ts`)
 * so flipping `--preset codex` actually swaps the model on every code path —
 * not just the CLI banner.
 *
 * The negative-absence assertion is the strongest invariant we can write
 * against silent fallback. A regression that brings back a `?? "claude-…"`
 * fallback at any consumer turns this test red.
 *
 * Allowlist (matched by relative path from the repo root):
 *   - .test.ts and .integration.ts files — tests and shared test fixtures.
 *   - any path under a /fixtures/ directory — eval-harness frozen workflow
 *     snapshots.
 *   - src/core/model/preset.ts — the shipped preset registry: every model
 *     id lands here when a vendor releases a new tier.
 *   - src/modules/model-clients/anthropic-pricing.ts — provider-shaped
 *     pricing table owned by the anthropic adapter.
 *   - src/modules/claude-agent-harness/adapter.ts — claude harness's
 *     SDK-internal model allowlist (per-adapter probe table).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(import.meta.dirname);
const REPO_ROOT = join(SRC_DIR, "..");

const ALLOWLIST = new Set<string>([
  "src/core/model/preset.ts",
  "src/modules/model-clients/anthropic-pricing.ts",
  "src/modules/claude-agent-harness/adapter.ts",
  // The grep test itself names the patterns; that file is the one place
  // the literal regex source must live.
  "src/no-hardcoded-model-defaults.integration.test.ts",
]);

const MODEL_LITERAL =
  /\b(claude-(opus|sonnet|haiku)-[0-9]|gpt-[0-9]|gemini-[0-9])/g;

type Offense = {
  file: string;
  line: number;
  snippet: string;
  match: string;
};

function isExcludedFile(rel: string): boolean {
  if (ALLOWLIST.has(rel)) return true;
  if (rel.endsWith(".test.ts")) return true;
  if (rel.endsWith(".integration.ts")) return true;
  if (rel.includes("/fixtures/")) return true;
  return false;
}

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

function scan(file: string): Offense[] {
  const rel = relative(REPO_ROOT, file);
  if (isExcludedFile(rel)) return [];
  const source = readFileSync(file, "utf-8");
  const offenses: Offense[] = [];
  MODEL_LITERAL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MODEL_LITERAL.exec(source)) !== null) {
    const before = source.slice(0, match.index);
    const line = before.split("\n").length;
    const lineStart = before.lastIndexOf("\n") + 1;
    const lineEnd = source.indexOf("\n", match.index);
    const snippet = source
      .slice(lineStart, lineEnd === -1 ? source.length : lineEnd)
      .trim();
    offenses.push({ file: rel, line, snippet, match: match[0] });
  }
  return offenses;
}

describe("no hardcoded vendor model id literals in production .ts under src/", () => {
  it("every non-allowlisted file is free of literal model ids", () => {
    const files = collectTsFiles(SRC_DIR);
    const offenses = files.flatMap(scan);

    if (offenses.length > 0) {
      const details = offenses
        .map((o) => `  ${o.file}:${o.line} [${o.match}] ${o.snippet}`)
        .join("\n");
      const message =
        `Found ${offenses.length} hardcoded vendor model id literal(s) in production code:\n${details}\n\n` +
        `Defaults must flow through the active preset. Use \`resolveDefaultModel\`, \`resolveTierModel\`, ` +
        `\`resolveDefaultEffort\`, or \`resolveActivePresetFromConfig\` from \`src/core/model/preset.ts\` ` +
        `instead of repeating a literal model id.\n\n` +
        `Allowlisted homes for legitimate literals: \`${[...ALLOWLIST].join("`, `")}\`.`;
      throw new Error(message);
    }

    expect(offenses).toEqual([]);
  });
});
