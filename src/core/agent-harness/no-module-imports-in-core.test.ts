/**
 * Import guard: no file under `src/core/` may reference a project module via
 * the `#modules/*` package-import subpath, with one narrow exception.
 *
 * The neutral-protocol audit drove `src/core/` to zero `#modules/*` imports
 * in non-test sources; the cross-harness test relocation pass extends that
 * invariant to test files as well. A regression that smuggles a
 * `#modules/*` import back into core — source or test — turns this test
 * red. The single sanctioned exception is the `KotaClient` aggregate file
 * `src/core/server/kota-client.ts`, which composes per-namespace client
 * interfaces declared in their owning modules (e.g. `DoctorClient` from
 * `#modules/doctor/client.js`). The exception is type-only by convention
 * and load-bearing for the namespace-distribution architecture: the
 * aggregate stays in core (as the single typed surface CLI code imports)
 * while every per-namespace contract lives with the module that owns its
 * implementation. New entries to the allowlist are appropriate as further
 * namespaces migrate; non-aggregate core files still fail the guard.
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

/**
 * Files under `src/core/` permitted to import from `#modules/*`. Limited to
 * the `KotaClient` namespace aggregate that composes per-namespace client
 * interfaces back from their owning modules. Each entry is a path relative
 * to `src/core/`. Adding a non-aggregate file here is almost always wrong:
 * core owns neutral protocols, and module-owned behavior belongs behind a
 * module protocol surface.
 */
const ALLOWED_FILES: ReadonlySet<string> = new Set<string>([
  "server/kota-client.ts",
]);

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

function isAllowed(offense: Offense): boolean {
  const rel = relative(CORE_DIR, join(REPO_ROOT, offense.file));
  return ALLOWED_FILES.has(rel);
}

describe("no #modules/* imports in src/core/", () => {
  it("every core .ts file is free of #modules/* references except the KotaClient aggregate", () => {
    const files = collectTsFiles(CORE_DIR);
    const offenses = files.flatMap(scan).filter((o) => !isAllowed(o));

    if (offenses.length > 0) {
      const details = offenses
        .map((o) => `  ${o.file}:${o.line} [${o.form}] ${o.snippet}`)
        .join("\n");
      const message =
        `core may not import from #modules/*; found ${offenses.length} offense(s):\n${details}\n` +
        `Core owns neutral protocols; module-owned behavior belongs behind the module protocol ` +
        `surfaces. The KotaClient aggregate (src/core/server/kota-client.ts) is the one ` +
        `sanctioned exception — it composes per-namespace client interfaces from their owning ` +
        `modules. Cross-cutting tests that legitimately need multiple modules belong at ` +
        `src/*.integration.test.ts, not under src/core/.`;
      throw new Error(message);
    }

    expect(offenses).toEqual([]);
  });

  it("the allowlist itself only references files that still exist and still import from #modules/*", () => {
    const files = collectTsFiles(CORE_DIR);
    const offendingFiles = new Set<string>(
      files
        .flatMap(scan)
        .map((o) => relative(CORE_DIR, join(REPO_ROOT, o.file))),
    );
    const stale: string[] = [];
    for (const allowed of ALLOWED_FILES) {
      if (!offendingFiles.has(allowed)) stale.push(allowed);
    }
    expect(
      stale,
      `ALLOWED_FILES contains entries that no longer import from #modules/*; ` +
        `remove them so the allowlist stays load-bearing: ${stale.join(", ")}`,
    ).toEqual([]);
  });
});
