/**
 * Guard test: every module that contributes CLI commands and a
 * KotaClient namespace must expose its local-side handler through the
 * top-level `localClient` factory so the loader can register it before
 * any subcommand runs (in either `"commands"` or `"runtime"` lifecycle mode).
 *
 * Newly-added namespaces fail the guard until both the owning module's
 * `localClient` factory returns a handler keyed by `<namespace>` AND the
 * namespace appears in `KOTA_CLIENT_NAMESPACES`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KOTA_CLIENT_NAMESPACES } from "./kota-client.js";

const MODULES_DIR = join(import.meta.dirname, "..", "..", "modules");

/**
 * Modules that own a namespace's local handler. Each must declare a
 * top-level `localClient` factory in its `index.ts` returning an object
 * whose key matches the namespace name.
 */
const NAMESPACE_OWNERS: Record<(typeof KOTA_CLIENT_NAMESPACES)[number], string> = {
  workflow: "workflow-ops",
  approvals: "approval-queue",
  secrets: "secrets",
  tasks: "repo-tasks",
  memory: "memory",
  ownerQuestions: "owner-questions",
  history: "history",
  knowledge: "knowledge",
  sessions: "daemon-ops",
  modules: "module-manager",
  agents: "agent-ops",
  skills: "skill-ops",
  harnessParity: "harness-parity",
  webhook: "webhook",
  voice: "voice",
  web: "web",
  mcpServer: "mcp-server",
  audit: "guardrails-audit",
  config: "config",
  modulesAdmin: "module-manager",
  daemonOps: "daemon-ops",
  projects: "daemon-ops",
  doctor: "doctor",
  evalHarness: "eval-harness",
  recall: "recall",
  answer: "answer",
  capture: "capture",
  retract: "retract",
};

function readModuleSource(name: string): string {
  return readFileSync(join(MODULES_DIR, name, "index.ts"), "utf-8");
}

describe("KotaClient namespace registration guard", () => {
  it.each(KOTA_CLIENT_NAMESPACES)(
    "module %s exposes a local handler via localClient()",
    (namespace) => {
      const owner = NAMESPACE_OWNERS[namespace];
      expect(
        owner,
        `KOTA_CLIENT_NAMESPACES contains "${namespace}" but no module owner is wired up in NAMESPACE_OWNERS.`,
      ).toBeDefined();
      const source = readModuleSource(owner);
      expect(
        /(\n|^)\s*localClient\s*:/.test(source),
        `Module "${owner}" must declare a top-level localClient factory in index.ts ` +
          `so the loader can register the "${namespace}" handler on the "commands" lifecycle path.`,
      ).toBe(true);
      const returnsNamespace =
        new RegExp(`return\\s*\\{[^}]*\\b${namespace}\\b`).test(source) ||
        new RegExp(`\\b${namespace}\\s*:\\s*\\w+`).test(source);
      expect(
        returnsNamespace,
        `Module "${owner}" localClient() must return an object whose key is ` +
          `"${namespace}" so LocalKotaClient resolves that namespace when no daemon is running.`,
      ).toBe(true);
    },
  );

  it("every module directory in NAMESPACE_OWNERS exists", () => {
    const dirs = new Set(readdirSync(MODULES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name));
    for (const owner of Object.values(NAMESPACE_OWNERS)) {
      expect(dirs.has(owner), `NAMESPACE_OWNERS references missing module "${owner}".`).toBe(true);
    }
  });
});

/**
 * Guard test: production module code under `src/modules/*` should not
 * import `DaemonControlClient` directly to call non-namespace transport
 * methods. Modules consume the typed `DaemonTransport` link or a module-
 * owned wrapper that uses it. The allowlist names test files that
 * exercise namespace-handler wire shapes (handlers that still live in
 * `src/core/server/daemon-client.ts` until the parent KotaClient
 * namespace distribution task moves them out).
 */
const DAEMON_CONTROL_CLIENT_IMPORT_ALLOWLIST: ReadonlySet<string> = new Set([
  // Tests that exercise daemon-side namespace handler wire format. Once
  // the parent task moves the namespace closures into their owning
  // modules, these tests move alongside the closures and can drop
  // off the allowlist.
  "history/client.test.ts",
  "mcp-server/mcp-server-operations.test.ts",
]);

function listModuleTsFiles(dir: string, rel: string): { rel: string; abs: string }[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const out: { rel: string; abs: string }[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
    const abs = join(dir, entry.name);
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...listModuleTsFiles(abs, next));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      out.push({ rel: next, abs });
    }
  }
  return out;
}

describe("daemon-client import boundary guard", () => {
  it("no module under src/modules/* imports DaemonControlClient outside the allowlist", () => {
    const files = listModuleTsFiles(MODULES_DIR, "");
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file.abs, "utf-8");
      const importsClass =
        /from\s+["']#core\/server\/daemon-client\.js["']/.test(src) &&
        /\bDaemonControlClient\b/.test(src);
      if (!importsClass) continue;
      if (DAEMON_CONTROL_CLIENT_IMPORT_ALLOWLIST.has(file.rel)) continue;
      offenders.push(file.rel);
    }
    expect(
      offenders,
      "Module files must use #core/server/daemon-transport.js (DaemonTransport / getDaemonTransport) " +
        "or a module-owned wrapper around it instead of importing DaemonControlClient directly. " +
        `Offenders:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the allowlist itself only references existing files", () => {
    for (const rel of DAEMON_CONTROL_CLIENT_IMPORT_ALLOWLIST) {
      const abs = join(MODULES_DIR, rel);
      expect(
        () => readFileSync(abs, "utf-8"),
        `DAEMON_CONTROL_CLIENT_IMPORT_ALLOWLIST entry "${rel}" does not point at an existing file.`,
      ).not.toThrow();
    }
  });
});
