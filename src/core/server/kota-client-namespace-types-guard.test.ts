/**
 * Guard test: new per-namespace request/response/options types must not be
 * declared under `src/core/server/` outside the shared `kota-client.ts`
 * aggregate.
 *
 * Sibling guards verify that every namespace has both a `localClient(ctx)`
 * and `daemonClient(link)` factory on its owning module. This guard
 * verifies the inverse: as namespaces migrate out of `daemon-client.ts`,
 * their request/response types must move to the owning module too — not
 * accumulate in adjacent core-server files. The shared aggregate
 * (`kota-client.ts`) is the only sanctioned home for cross-namespace
 * declarations under `src/core/server/`.
 *
 * The guard scans every `.ts` file in `src/core/server/` except
 * `kota-client.ts` and `*.test.ts` for `export type` /
 * `export interface` declarations whose name ends in
 * `Filter` / `Result` / `Options` / `Response` / `ListEntry`. Each match
 * must appear in the allowlist or fail the test. Adding a new entry to
 * the allowlist is acceptable for genuinely-infrastructure types (server,
 * transport, link options); per-namespace types belong in the owning
 * module.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SERVER_DIR = import.meta.dirname;

/**
 * Pre-existing types whose names match the per-namespace pattern but are
 * legitimate infrastructure-level declarations. These entries are
 * configuration shapes for the server runtime, the daemon-link watcher, the
 * session-pool, and the client-selector itself — none of them are
 * per-namespace request/response types.
 */
const NAMESPACE_TYPE_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  "DaemonLinkOptions",
  "ServerOptions",
  "SessionPoolOptions",
  "ResolveKotaClientOptions",
]);

const NAMESPACE_TYPE_PATTERN =
  /^export\s+(?:type|interface)\s+([A-Z][A-Za-z0-9_]*?(?:Filter|Result|Options|Response|ListEntry))\b/;

function listServerSourceFiles(): string[] {
  const entries = readdirSync(SERVER_DIR, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    if (entry.name.endsWith(".d.ts")) continue;
    if (entry.name === "kota-client.ts") continue;
    out.push(join(SERVER_DIR, entry.name));
  }
  return out;
}

describe("KotaClient namespace types must not accumulate under src/core/server/", () => {
  it("no new per-namespace request/response/options types under src/core/server/ outside the allowlist", () => {
    const offenders: { file: string; line: number; name: string }[] = [];
    for (const abs of listServerSourceFiles()) {
      const source = readFileSync(abs, "utf-8");
      const lines = source.split("\n");
      for (let idx = 0; idx < lines.length; idx += 1) {
        const match = lines[idx]!.match(NAMESPACE_TYPE_PATTERN);
        if (!match) continue;
        const typeName = match[1]!;
        if (NAMESPACE_TYPE_ALLOWLIST.has(typeName)) continue;
        const rel = abs.slice(SERVER_DIR.length + 1);
        offenders.push({ file: rel, line: idx + 1, name: typeName });
      }
    }
    expect(
      offenders,
      "Per-namespace request/response/options types must move out of src/core/server/. " +
        "Either declare them in the owning module (where the namespace's daemonClient/localClient " +
        "factory lives) or, if the type is genuinely infrastructure-level, add it to " +
        "NAMESPACE_TYPE_ALLOWLIST with a comment explaining why. " +
        `Offenders:\n  ${offenders.map((o) => `${o.file}:${o.line} ${o.name}`).join("\n  ")}`,
    ).toEqual([]);
  });

  it("the allowlist itself only references types that still exist", () => {
    const declared = new Set<string>();
    for (const abs of listServerSourceFiles()) {
      const source = readFileSync(abs, "utf-8");
      for (const line of source.split("\n")) {
        const match = line.match(NAMESPACE_TYPE_PATTERN);
        if (match) declared.add(match[1]!);
      }
    }
    const stale: string[] = [];
    for (const name of NAMESPACE_TYPE_ALLOWLIST) {
      if (!declared.has(name)) stale.push(name);
    }
    expect(
      stale,
      `NAMESPACE_TYPE_ALLOWLIST contains entries no longer declared under src/core/server/: ` +
        stale.join(", "),
    ).toEqual([]);
  });
});
