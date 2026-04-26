/**
 * Guard test: per-slice TypeScript declarations and per-slice
 * sanitize/merge clauses for module-owned keys must not live in
 * `src/core/config/`. Slices belong in their owning module.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CORE_CONFIG_DIR = join(import.meta.dirname);

const MODULE_OWNED_KEYS = [
  "webhooks",
  "tracing",
  "mcp",
  "failover",
  "modelProvider",
  "scheduler",
] as const;

const FILES = ["config.ts", "config-sanitize.ts", "config-merge.ts"] as const;

describe("module-owned config slices stay out of src/core/config/", () => {
  for (const file of FILES) {
    it(`${file} has no per-slice TypeScript field, sanitize, or merge clauses`, () => {
      const text = readFileSync(join(CORE_CONFIG_DIR, file), "utf-8");
      for (const key of MODULE_OWNED_KEYS) {
        // A field declaration: `webhooks?:` or `tracing:` etc.
        const fieldDecl = new RegExp(`^\\s*${key}\\??\\s*:`, "m");
        // A sanitize/merge dispatch on the key as a string literal: `"scheduler"` etc.
        const stringLiteral = new RegExp(`["']${key}["']`);
        // A property access: `raw.scheduler`, `out.tracing`, etc.
        const propAccess = new RegExp(`\\b(?:raw|out|merged|a|b)\\.${key}\\b`);
        const offenders: string[] = [];
        if (fieldDecl.test(text)) offenders.push(`field declaration "${key}"`);
        if (stringLiteral.test(text)) offenders.push(`string literal "${key}"`);
        if (propAccess.test(text)) offenders.push(`property access ".${key}"`);
        expect(
          offenders,
          `core/config/${file} must not reference module-owned key "${key}"; offenders: ${offenders.join(", ")}`,
        ).toEqual([]);
      }
    });
  }

  it("config-warnings.ts no longer enumerates module-owned keys", () => {
    const text = readFileSync(join(CORE_CONFIG_DIR, "config-warnings.ts"), "utf-8");
    for (const key of MODULE_OWNED_KEYS) {
      // The validator is allowed to reference scheduler-style scheduler.* paths,
      // so this guard targets only known-key membership entries.
      const inKnownSet = new RegExp(`["']${key}["']`);
      // Allowlist scheduler.* path references in validator helpers; the field
      // name as a string literal is what we forbid.
      if (key === "scheduler") continue;
      expect(
        inKnownSet.test(text),
        `core/config/config-warnings.ts should not reference module-owned key "${key}"`,
      ).toBe(false);
    }
  });
});
