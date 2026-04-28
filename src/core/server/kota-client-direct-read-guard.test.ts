/**
 * Sibling guard test: rejects new direct `.kota/` filesystem reads from
 * any non-bootstrap CLI subcommand action handler under `src/modules/*`.
 *
 * The companion guard at `kota-client-guard.test.ts` verifies that every
 * declared `KotaClient` namespace has an owning module's `localClient`
 * factory. This guard verifies the inverse invariant: now that every
 * non-bootstrap CLI subcommand has been migrated to consume
 * `ctx.client.<namespace>.<method>()`, no future subcommand may quietly
 * re-introduce a `.kota/` read that bypasses the contract.
 *
 * Rules:
 * - Files in scope are CLI handler files under `src/modules/<module>/`:
 *   `cli.ts`, `index.ts` (the latter only when it actually registers
 *   commands), and `<*>-cli.ts` siblings used by command handlers.
 * - Bootstrap-exempt modules (`init`, `registry`, `completion`) are
 *   skipped wholesale: their CLI surfaces own first-run repo
 *   initialization and capability discovery and must touch `.kota/`
 *   directly.
 * - The `daemon-ops` module is partially exempt: only the `install` /
 *   `uninstall` subcommands and the OS-service file plumbing in
 *   `service-install.ts` may reference `.kota/` paths (they write the
 *   plist log target). All other daemon-ops subcommand handlers must
 *   route through the namespace.
 * - The guard skips test files, AGENTS.md docs, and supporting helper
 *   files that are imported by the local-client handler (the namespace's
 *   implementor — not the CLI handler — is the right place for direct
 *   `.kota/` access).
 *
 * Implementation: filesystem-static. Strips line and block comments,
 * then searches for a `.kota` literal in the remaining source. Raises a
 * single test failure per offending file with a pointer to the offending
 * line so the migration owner can add the file to the allowlist (after
 * confirming it is genuinely a local-handler implementor) or migrate it
 * through the namespace.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const MODULES_DIR = join(REPO_ROOT, "src", "modules");

/**
 * Modules whose CLI surfaces are bootstrap-only and must access
 * `.kota/` directly. The `init` module materializes the first-run
 * project state; `registry` enumerates available KOTA modules before
 * any are loaded; `completion` writes the shell completion script.
 * Adding a module here requires updating the parent migration's
 * "bootstrap exemption" note in the owning task source.
 */
const BOOTSTRAP_EXEMPT_MODULES = new Set<string>([
  "init",
  "registry",
  "completion",
]);

/**
 * Files that legitimately implement a local-client namespace (as
 * contributed through `localClient(ctx)`) or own bootstrap surfaces
 * within an otherwise non-exempt module. These files are imported by
 * the corresponding module's `localClient` factory, not by the CLI
 * action handler, so direct `.kota/` access is correct.
 */
const HANDLER_IMPL_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // daemon-ops bootstrap-exempt subcommands (install/uninstall) plus
  // the OS-service path helpers they consume. The status/pid/stop/reload
  // handlers in index.ts route through ctx.client.daemonOps and do not
  // touch .kota/ directly.
  "daemon-ops/service-install.ts",
  // The local-side daemonOps handler reads .kota/daemon-control.json to
  // distinguish "not running" from "stale control file"; it is the
  // namespace's implementor, not a CLI subcommand action.
  "daemon-ops/daemon-ops-operations.ts",
  // QR command exposes the daemon control plane (URL + bearer token) to a
  // mobile client. The state file IS the contract surface here — the
  // command's job is to encode that file's contents for an external
  // client to consume, similar to `daemon install`'s plist target.
  "daemon-ops/qr-cli.ts",
  // `kota status` builds a daemon-up/down snapshot reading from both the
  // live daemon and offline run-state files. The offline branch needs
  // direct WorkflowRunStore + approval-queue access; both are daemon
  // control plane primitives (the daemon owns them when running).
  "daemon-ops/status-cli.ts",
  "daemon-ops/session-cli.ts",
  "daemon-ops/events-cli.ts",
  // Local-client implementor files for migrated namespaces.
  "config/config-operations.ts",
  "config/config-control-routes.ts",
  "guardrails-audit/audit-operations.ts",
  "guardrails-audit/audit-control-routes.ts",
  "doctor/doctor-checks.ts",
  "doctor/doctor-control-routes.ts",
  "eval-harness/eval-operations.ts",
  "eval-harness/eval-control-routes.ts",
  "eval-harness/routes.ts",
  // The audit tool runner and its store live below the CLI surface; the
  // tool is invoked through agent harness, not through a CLI subcommand
  // action handler.
  "guardrails-audit/audit-tool.ts",
  // Existing ops files for already-migrated CLIs that read .kota/* state.
  "memory/index.ts",
  "secrets/index.ts",
  "knowledge/index.ts",
  "skill-ops/index.ts",
  "harness-parity/index.ts",
  "google-workspace/index.ts",
  "prompt-templates/index.ts",
  "sqlite-memory/index.ts",
  // Answer module owns the persisted answer-history store under
  // <projectStateRoot>/answer-history/. The path resolution lives in the
  // localClient factory for the answer namespace, not in a CLI handler;
  // the CLI subcommand routes through ctx.client.answer.{log,show}().
  "answer/index.ts",
]);

/** Files that don't house CLI command handlers — exclude from the scan. */
function isExcludedFile(name: string): boolean {
  if (name.endsWith(".test.ts")) return true;
  if (name.endsWith(".d.ts")) return true;
  return false;
}

function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let inBlockComment = false;
  let inLineComment = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  while (i < source.length) {
    const c = source[i]!;
    const next = i + 1 < source.length ? source[i + 1]! : "";

    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        out += "  ";
        continue;
      }
      i += 1;
      out += c === "\n" ? "\n" : " ";
      continue;
    }
    if (inLineComment) {
      if (c === "\n") {
        inLineComment = false;
        out += "\n";
      } else {
        out += " ";
      }
      i += 1;
      continue;
    }
    if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (c === "/" && next === "/") {
        inLineComment = true;
        i += 2;
        out += "  ";
        continue;
      }
      if (c === "/" && next === "*") {
        inBlockComment = true;
        i += 2;
        out += "  ";
        continue;
      }
    }

    if (c === "\\" && (inSingleQuote || inDoubleQuote || inBacktick)) {
      out += c;
      out += next;
      i += 2;
      continue;
    }
    if (c === "'" && !inDoubleQuote && !inBacktick) {
      inSingleQuote = !inSingleQuote;
    } else if (c === '"' && !inSingleQuote && !inBacktick) {
      inDoubleQuote = !inDoubleQuote;
    } else if (c === "`" && !inSingleQuote && !inDoubleQuote) {
      inBacktick = !inBacktick;
    }
    out += c;
    i += 1;
  }
  return out;
}

function findKotaLineNumbers(source: string): number[] {
  const stripped = stripComments(source);
  const lines = stripped.split("\n");
  const hits: number[] = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    if (/(["'`])\.kota\b/.test(lines[idx]!) || /\bjoin\([^)]*["'`]\.kota["'`]/.test(lines[idx]!)) {
      hits.push(idx + 1);
    }
  }
  return hits;
}

function listCliHandlerFiles(moduleDir: string): string[] {
  let entries: { name: string; isFile: boolean; isDirectory: boolean }[];
  try {
    const list = readdirSync(moduleDir, { withFileTypes: true });
    entries = list.map((e) => ({ name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory() }));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile) continue;
    if (!entry.name.endsWith(".ts")) continue;
    if (isExcludedFile(entry.name)) continue;
    if (
      entry.name === "cli.ts" ||
      entry.name === "index.ts" ||
      entry.name.endsWith("-cli.ts")
    ) {
      out.push(join(moduleDir, entry.name));
    }
  }
  return out;
}

function listNonBootstrapModules(): string[] {
  let entries: { name: string; isDir: boolean }[];
  try {
    const list = readdirSync(MODULES_DIR, { withFileTypes: true });
    entries = list.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDir && !BOOTSTRAP_EXEMPT_MODULES.has(e.name))
    .map((e) => e.name);
}

describe("CLI handlers must not read .kota/ directly", () => {
  const violations: { path: string; lines: number[] }[] = [];

  for (const moduleName of listNonBootstrapModules()) {
    const moduleDir = join(MODULES_DIR, moduleName);
    let stat;
    try {
      stat = statSync(moduleDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    for (const file of listCliHandlerFiles(moduleDir)) {
      const rel = relative(MODULES_DIR, file).replace(/\\/g, "/");
      if (HANDLER_IMPL_ALLOWLIST.has(rel)) continue;
      const source = readFileSync(file, "utf-8");
      const hits = findKotaLineNumbers(source);
      if (hits.length > 0) {
        violations.push({ path: rel, lines: hits });
      }
    }
  }

  it("no non-bootstrap CLI handler file references `.kota/` literally", () => {
    if (violations.length === 0) {
      expect(violations).toEqual([]);
      return;
    }
    const detail = violations
      .map((v) => `  ${v.path}: line(s) ${v.lines.join(", ")}`)
      .join("\n");
    throw new Error(
      `${violations.length} CLI handler file(s) reference \`.kota/\` directly:\n${detail}\n\n` +
        "Move the read into the owning module's `localClient(ctx)` namespace handler " +
        "(and add the file to HANDLER_IMPL_ALLOWLIST) or route the CLI through " +
        "ctx.client.<namespace>.<method>().",
    );
  });
});
