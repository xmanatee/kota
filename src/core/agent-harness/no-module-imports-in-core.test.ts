/**
 * Import guard: no file under `src/core/` may reference a project module via
 * the `#modules/*` package-import subpath.
 *
 * The neutral-protocol audit drove `src/core/` to zero `#modules/*` imports
 * in non-test sources; the cross-harness test relocation pass extends that
 * invariant to test files as well. A regression that smuggles a
 * `#modules/*` import back into core — source or test — turns this test
 * red. There is intentionally no file allowlist: if new core code needs
 * module-owned behavior, extend the neutral protocol or move the test to
 * the cross-cutting `src/*.integration.test.ts` tier.
 *
 * Recognized import forms (all targeting any `#modules/<name>` specifier):
 *   - static `import ... from ...` (type and value)
 *   - bare side-effect `import '...'`
 *   - dynamic `import(...)`
 *   - `require(...)`
 *   - `vi.mock(...)`
 *   - `export ... from ...`
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
    regex: /\bfrom\s+["']#modules\/[^"']+["']/g,
  },
  {
    form: "side-effect import",
    regex: /\bimport\s+["']#modules\/[^"']+["']/g,
  },
  {
    form: "dynamic import()",
    regex: /\bimport\s*\(\s*["']#modules\/[^"']+["']/g,
  },
  {
    form: "require()",
    regex: /\brequire\s*\(\s*["']#modules\/[^"']+["']/g,
  },
  {
    form: "vi.mock()",
    regex: /\bvi\.mock\s*\(\s*["']#modules\/[^"']+["']/g,
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

describe("no #modules/* imports in src/core/", () => {
  it("every core .ts file is free of #modules/* references", () => {
    const files = collectTsFiles(CORE_DIR);
    const offenses = files.flatMap(scan);

    if (offenses.length > 0) {
      const details = offenses
        .map((o) => `  ${o.file}:${o.line} [${o.form}] ${o.snippet}`)
        .join("\n");
      const message =
        `core may not import from #modules/*; found ${offenses.length} offense(s):\n${details}\n` +
        `Core owns neutral protocols; module-owned behavior belongs behind the module protocol ` +
        `surfaces. Cross-cutting tests that legitimately need multiple modules belong at ` +
        `src/*.integration.test.ts, not under src/core/.`;
      throw new Error(message);
    }

    expect(offenses).toEqual([]);
  });
});
