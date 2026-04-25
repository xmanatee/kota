/**
 * Guard test: every module that contributes CLI commands and a
 * KotaClient namespace must expose its local-side handler through the
 * top-level `localClient` factory so the loader can register it before
 * any subcommand runs (independent of `commandsOnly` mode).
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
          `so the loader can register the "${namespace}" handler in commandsOnly mode.`,
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
