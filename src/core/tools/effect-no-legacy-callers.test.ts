/**
 * Guard test: `legacyEffect()` is the two-axis (risk/kind) translation seam for
 * external tool formats. Production module and core code must declare effects
 * directly through the typed builders in `effect.ts`.
 *
 * Allowed callers:
 *   - `src/core/tools/tool-adapters.ts` — translates the legacy
 *     SimpleTool/OpenAI/Vercel two-axis schema into KOTA effects.
 *   - test files (`*.test.ts`, `*.integration.test.ts`).
 *
 * Adding a non-test caller anywhere else in `src/` turns this test red. The
 * fix is to switch the caller to a concrete effect builder
 * (`readOnlyLocalEffect`, `networkDestructiveEffect`, etc.) or to a
 * structurally explicit literal.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");

const ALLOWED_CALLERS: ReadonlySet<string> = new Set([
  "src/core/tools/tool-adapters.ts",
  // The definition file itself.
  "src/core/tools/effect.ts",
]);

const TEST_FILE = /\.(?:test|integration|integration\.test)\.ts$/;

function* walk(dir: string): IterableIterator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      yield full;
    }
  }
}

describe("legacyEffect is restricted to the external-format adapter seam", () => {
  it("no production caller imports or invokes legacyEffect outside the allow-list", () => {
    const offenders: string[] = [];
    for (const filePath of walk(SRC_DIR)) {
      const rel = relative(REPO_ROOT, filePath).replace(/\\/g, "/");
      if (TEST_FILE.test(rel)) continue;
      if (ALLOWED_CALLERS.has(rel)) continue;
      const body = readFileSync(filePath, "utf-8");
      // Match named imports of `legacyEffect`. An import is the only way a
      // production file can wire to the function; bare token mentions inside
      // backtick-quoted prompt strings or comments do not count.
      const imports = /import\s*(?:type\s*)?\{[^}]*\blegacyEffect\b[^}]*\}\s*from/.test(body);
      if (imports) {
        offenders.push(rel);
      }
    }

    if (offenders.length > 0) {
      throw new Error(
        "Production code must not call `legacyEffect()`. Use a concrete " +
          "effect builder from `#core/tools/effect.js` (e.g. " +
          "`readOnlyLocalEffect`, `networkDestructiveEffect`, " +
          "`localWriteEffect`) or write an explicit `ToolEffect` literal. " +
          "Files:\n" +
          offenders.map((s) => `  - ${s}`).join("\n"),
      );
    }
    expect(offenders).toEqual([]);
  });
});
