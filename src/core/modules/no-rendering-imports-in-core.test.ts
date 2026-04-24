/**
 * Import guard: no file under `src/core/` may import from the rendering
 * module (`#modules/rendering/...`).
 *
 * The rendering module owns the primitive vocabulary, the terminal
 * transport, and the `CliTransport` that paints operator-facing agent
 * events. Core resolves operator-facing surfaces through a neutral
 * `RenderingProvider` that the module registers during `onLoad`; the
 * loop constructor and `src/core/repl/harness-repl.ts` reach the
 * default implementation via `getRenderingProvider()` in
 * `#core/modules/provider-registry.js`. Reintroducing a
 * `#modules/rendering` import under `src/core/` turns core back into a
 * hard consumer of the rendering module and breaks any deployment that
 * swaps or disables it. This guard mirrors the peer guards in
 * `no-voice-imports-in-core.test.ts`,
 * `no-history-imports-in-core.test.ts`, and
 * `no-execution-module-imports-in-core.test.ts`.
 *
 * Recognized import forms (all targeting the `#modules/rendering`
 * package specifier, case-sensitive, with or without a subpath suffix):
 *   - static `import ... from ...` (type and value)
 *   - bare side-effect `import '...'`
 *   - dynamic `import(...)`
 *   - `require(...)`
 *   - `vi.mock(...)`
 *   - `export ... from ...`
 *
 * The walk covers every `.ts` file under `src/core/` (including tests)
 * so a future change cannot smuggle the dependency back in through a
 * test file. There is intentionally no file allowlist: if a future core
 * contract needs a rendering-specific shape, widen `RenderingProvider`
 * (or add a new core-owned protocol) and push the specifics into the
 * module.
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
    regex: /\bfrom\s+["']#modules\/rendering(?:\/[^"']*)?["']/g,
  },
  {
    form: "side-effect import",
    regex: /\bimport\s+["']#modules\/rendering(?:\/[^"']*)?["']/g,
  },
  {
    form: "dynamic import()",
    regex: /\bimport\s*\(\s*["']#modules\/rendering(?:\/[^"']*)?["']/g,
  },
  {
    form: "require()",
    regex: /\brequire\s*\(\s*["']#modules\/rendering(?:\/[^"']*)?["']/g,
  },
  {
    form: "vi.mock()",
    regex: /\bvi\.mock\s*\(\s*["']#modules\/rendering(?:\/[^"']*)?["']/g,
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

describe("no #modules/rendering imports in src/core/", () => {
  it("every core .ts file is free of #modules/rendering references", () => {
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
        `core may not import #modules/rendering; found ${offenses.length} offense(s):\n${details}\n` +
        `The rendering module registers the default CLI transport and ` +
        `REPL chrome as the "rendering" provider during onLoad. Core ` +
        `resolves them through getRenderingProvider() in ` +
        `src/core/modules/provider-registry.ts and imports protocol ` +
        `types (RenderingProvider, ReplChrome) from ` +
        `src/core/modules/provider-types.ts. See ` +
        `src/modules/rendering/AGENTS.md.`;
      throw new Error(message);
    }

    expect(offenses).toEqual([]);
  });
});
