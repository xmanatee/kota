/**
 * Import guard: no file under `src/core/` may reference the Anthropic SDK
 * package (`@anthropic-ai/sdk`).
 *
 * Stage 6 of the Anthropic SDK type-surface audit promotes the
 * "core speaks KOTA-owned neutral types" boundary from a soft claim into an
 * enforced invariant. After Stages 1-5, nothing under `src/core/` imports
 * the Anthropic SDK; adapter modules own the translation between
 * `KotaMessage` / `KotaTool` / `KotaThinkingConfig` / `KotaModelResponse`
 * and the provider-native wire shapes. A regression that smuggles an
 * Anthropic type back into core turns this test red.
 *
 * Recognized import forms (all targeting the Anthropic SDK package
 * specifier, case-sensitive, with or without a subpath suffix):
 *   - static `import ... from ...` (type and value)
 *   - bare side-effect `import '...'`
 *   - dynamic `import(...)`
 *   - `require(...)`
 *   - `vi.mock(...)`
 *   - `export ... from ...`
 *
 * The walk is restricted to `.ts` files so the audit's markdown prose does
 * not need an allowlist. There is intentionally no file allowlist: if a
 * future core contract needs a provider-specific shape, widen the neutral
 * protocol or push the translation into an adapter module, do not exempt
 * a file here.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const CORE_DIR = join(import.meta.dirname, "..");
const REPO_ROOT = join(CORE_DIR, "..", "..");

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

type Offense = {
  file: string;
  form: string;
  line: number;
  snippet: string;
};

const PATTERNS: Array<{ form: string; regex: RegExp }> = [
  {
    form: "static import/re-export",
    regex: /\bfrom\s+["']@anthropic-ai\/sdk(?:\/[^"']*)?["']/g,
  },
  {
    form: "side-effect import",
    regex: /\bimport\s+["']@anthropic-ai\/sdk(?:\/[^"']*)?["']/g,
  },
  {
    form: "dynamic import()",
    regex: /\bimport\s*\(\s*["']@anthropic-ai\/sdk(?:\/[^"']*)?["']/g,
  },
  {
    form: "require()",
    regex: /\brequire\s*\(\s*["']@anthropic-ai\/sdk(?:\/[^"']*)?["']/g,
  },
  {
    form: "vi.mock()",
    regex: /\bvi\.mock\s*\(\s*["']@anthropic-ai\/sdk(?:\/[^"']*)?["']/g,
  },
];

function scan(file: string): Offense[] {
  const source = readFileSync(file, "utf-8");
  const offenses: Offense[] = [];
  for (const { form, regex } of PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      const before = source.slice(0, match.index);
      const line = before.split("\n").length;
      const lineStart = before.lastIndexOf("\n") + 1;
      const lineEnd = source.indexOf("\n", match.index);
      const snippet = source
        .slice(lineStart, lineEnd === -1 ? source.length : lineEnd)
        .trim();
      offenses.push({
        file: relative(REPO_ROOT, file),
        form,
        line,
        snippet,
      });
    }
  }
  return offenses;
}

describe("no @anthropic-ai/sdk imports in src/core/", () => {
  it("every core .ts file is free of @anthropic-ai/sdk references", () => {
    const files = collectTsFiles(CORE_DIR);
    const offenses = files.flatMap(scan);

    if (offenses.length > 0) {
      const details = offenses
        .map(
          (o) =>
            `  ${o.file}:${o.line} [${o.form}] ${o.snippet}`,
        )
        .join("\n");
      const message =
        `core may not import @anthropic-ai/sdk; found ${offenses.length} offense(s):\n${details}\n` +
        `Adapter modules own the translation between KOTA-owned neutral types and the Anthropic SDK wire shape. ` +
        `See src/core/agent-harness/anthropic-type-audit.md for the ownership target and ` +
        `src/core/agent-harness/AGENTS.md for the boundary rule.`;
      throw new Error(message);
    }

    expect(offenses).toEqual([]);
  });
});
