/**
 * Import guard: no file under `src/core/` may import from the execution
 * module (`#modules/execution/...`).
 *
 * Core owns the declarative surface for `custom_tool` and manifest-defined
 * tools but defers language-specific execution to executor modules through
 * the neutral `CodeRunner` protocol in `src/core/tools/code-runner.ts`.
 * Reintroducing a `#modules/execution` import under `src/core/` turns core
 * back into a hard consumer of the execution module and breaks any deployment
 * that swaps or disables it. This guard mirrors the Stage 6 Anthropic-SDK
 * import guard under `src/core/agent-harness/`.
 *
 * Recognized import forms (all targeting the `#modules/execution` package
 * specifier, case-sensitive, with or without a subpath suffix):
 *   - static `import ... from ...` (type and value)
 *   - bare side-effect `import '...'`
 *   - dynamic `import(...)`
 *   - `require(...)`
 *   - `vi.mock(...)`
 *   - `export ... from ...`
 *
 * The walk covers every `.ts` file under `src/core/` (including tests) so a
 * future change cannot smuggle the dependency back in through a test file.
 * There is intentionally no file allowlist: if a future core contract needs
 * a runtime-module-specific shape, widen `CodeRunner` (or add a new core-
 * owned protocol) and push the specifics into the module adapter.
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
    regex: /\bfrom\s+["']#modules\/execution(?:\/[^"']*)?["']/g,
  },
  {
    form: "side-effect import",
    regex: /\bimport\s+["']#modules\/execution(?:\/[^"']*)?["']/g,
  },
  {
    form: "dynamic import()",
    regex: /\bimport\s*\(\s*["']#modules\/execution(?:\/[^"']*)?["']/g,
  },
  {
    form: "require()",
    regex: /\brequire\s*\(\s*["']#modules\/execution(?:\/[^"']*)?["']/g,
  },
  {
    form: "vi.mock()",
    regex: /\bvi\.mock\s*\(\s*["']#modules\/execution(?:\/[^"']*)?["']/g,
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

describe("no #modules/execution imports in src/core/", () => {
  it("every core .ts file is free of #modules/execution references", () => {
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
        `core may not import #modules/execution; found ${offenses.length} offense(s):\n${details}\n` +
        `Core-hosted code executes agent-authored code through the CodeRunner ` +
        `protocol in src/core/tools/code-runner.ts. Module adapters register ` +
        `runners on load; core callers invoke runCode(language, code, params). ` +
        `See src/core/tools/AGENTS.md for the boundary rule.`;
      throw new Error(message);
    }

    expect(offenses).toEqual([]);
  });
});
