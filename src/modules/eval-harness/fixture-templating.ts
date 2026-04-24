/**
 * Fixture-tree templating pass.
 *
 * Applied by the runner to every file under a freshly materialized fixture
 * working directory so fixture authors can express "this seed is N hours
 * old at run time" without either hard-coding a fragile timestamp or
 * inventing a second setup surface.
 *
 * Today the only templates are relative ISO timestamps. They are scoped
 * intentionally narrowly: a substitution mechanism that fires on every
 * fixture run is a shared contract, so the known-template set stays in
 * code and is enforced by unit tests. Unknown `{{...}}` tokens pass
 * through unchanged — the runner is not a general templating engine.
 *
 *  - `{{NOW_MINUS_HOURS:N}}` → ISO timestamp `N` hours before `now`.
 *  - `{{NOW_MINUS_MINUTES:N}}` → ISO timestamp `N` minutes before `now`.
 *
 * The pass reads each file as UTF-8 and rewrites it only when at least one
 * known template matched. Binary files (node_modules, compiled assets) are
 * never present in fixture initial/ trees today; if one ever lands, the
 * pattern is specific enough not to match, so the file content round-trips
 * unchanged at the cost of one UTF-8 decode.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOURS_PATTERN = /\{\{NOW_MINUS_HOURS:(\d+)\}\}/g;
const MINUTES_PATTERN = /\{\{NOW_MINUS_MINUTES:(\d+)\}\}/g;

/**
 * Substitute every known relative-timestamp template in `input` against
 * `nowMs`. Returns the untouched input when no template matched so callers
 * can skip the write.
 */
export function substituteFixtureTemplates(input: string, nowMs: number): {
  output: string;
  changed: boolean;
} {
  let changed = false;
  const afterHours = input.replace(HOURS_PATTERN, (_match, raw: string) => {
    changed = true;
    const hours = Number.parseInt(raw, 10);
    return new Date(nowMs - hours * 60 * 60 * 1000).toISOString();
  });
  const afterMinutes = afterHours.replace(
    MINUTES_PATTERN,
    (_match, raw: string) => {
      changed = true;
      const minutes = Number.parseInt(raw, 10);
      return new Date(nowMs - minutes * 60 * 1000).toISOString();
    },
  );
  return { output: afterMinutes, changed };
}

/**
 * Walk `root` and apply `substituteFixtureTemplates` to every regular file.
 * Writes back only files whose content actually changed.
 */
export function applyFixtureTemplates(root: string, nowMs: number): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      applyFixtureTemplates(full, nowMs);
      continue;
    }
    if (!entry.isFile()) continue;
    // Symlinks and sockets are not materialized by cpSync's default recursive
    // copy for our fixtures; skip anything that isn't a regular file.
    if (!statSync(full).isFile()) continue;
    const content = readFileSync(full, "utf-8");
    const { output, changed } = substituteFixtureTemplates(content, nowMs);
    if (changed) writeFileSync(full, output, "utf-8");
  }
}
