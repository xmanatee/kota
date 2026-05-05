/**
 * Secrets module — secure credential management with output masking.
 *
 * Registers:
 * - `kota secrets set/get/list/remove` CLI commands
 * - `get_secret` agent tool (injects into env, returns placeholder to LLM)
 *
 * The agent tool uses ModuleContext.getSecret() via closure — demonstrating
 * the self-contained module pattern where tool runners access services
 * through the context rather than importing core singletons.
 */


import { createInterface } from "node:readline";
import { Command } from "commander";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { getSecretStore, initSecretStore } from "#core/config/secrets.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { readOnlyDaemonEffect } from "#core/tools/effect.js";
import type { ToolResult } from "#core/tools/index.js";
import type {
  SecretGetResult,
  SecretListResult,
  SecretMutateResult,
  SecretScope,
  SecretsClient,
} from "./client.js";
import { secretsRoutes } from "./routes.js";

function ensureLocalStore(ctx: ModuleContext): ReturnType<typeof initSecretStore> {
  return getSecretStore() ?? initSecretStore(ctx.cwd);
}

const getSecretTool: KotaTool = {
  name: "get_secret",
  description:
    "Retrieve a secret (API key, token, credential) and inject it into the environment. " +
    "The actual value is injected into process.env for use by shell/code_exec tools. " +
    "You receive a masked placeholder — never the real value. " +
    "Use this before running commands that need credentials.",
  input_schema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "Name of the secret to retrieve (e.g. OPENAI_API_KEY, GITHUB_TOKEN)",
      },
    },
    required: ["name"],
  },
};

/** Build the get_secret tool runner with context-injected secret access. */
function makeGetSecretRunner(ctx: ModuleContext) {
  return async (input: Record<string, unknown>): Promise<ToolResult> => {
    const name = input.name as string;
    if (!name || typeof name !== "string") {
      return { content: "Error: secret name is required", is_error: true };
    }

    // Use ctx.getSecret() instead of importing getSecretStore() directly
    const value = ctx.getSecret(name);
    if (!value) {
      // Fall back to store for listing available secrets in error hint
      const store = getSecretStore();
      const available = store ? store.list().map((s) => s.name) : [];
      const hint = available.length > 0
        ? `\nAvailable secrets: ${available.join(", ")}`
        : "\nNo secrets configured. Use 'kota secrets set <name>' to add one.";
      return { content: `Secret "${name}" not found.${hint}`, is_error: true };
    }

    // Inject into process.env so shell/code_exec tools can use it
    process.env[name] = value;
    ctx.log.debug(`Secret "${name}" injected into environment`);

    return {
      content: `Secret "${name}" injected into environment as $${name}. Value: <secret:${name}>`,
    };
  };
}

/** Prompt the user for a secret value on stdin (hidden input). */
function promptSecretValue(name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write(`Enter value for "${name}": `);

    rl.on("line", (line) => {
      rl.close();
      resolve(line.trim());
    });
    rl.on("close", () => reject(new Error("Input cancelled")));
    rl.on("error", reject);
  });
}

function parseScope(opts: { global?: boolean; project?: boolean }): SecretScope {
  if (opts.global) return "global";
  return "project";
}

const secretsModule: KotaModule = {
  name: "secrets",
  version: "1.0.0",
  description: "Secure credential management with output masking",

  // Tools as factory function — runner captures ctx via closure
  tools: (ctx) => [
    {
      tool: getSecretTool,
      runner: makeGetSecretRunner(ctx),
      effect: readOnlyDaemonEffect(),
      group: "management",
    },
  ],

  routes: () => secretsRoutes(),

  commands: (ctx) => {
    const cmd = new Command("secrets").description("Manage secrets and credentials");

    cmd
      .command("set <name>")
      .description("Store a secret (prompts for value — never pass secrets as arguments)")
      .option("-g, --global", "Store in global ~/.kota/ scope (default: project)")
      .option("-p, --project", "Store in project .kota/ scope")
      .action(async (name: string, opts) => {
        const scope = parseScope(opts);
        let value: string;
        try {
          value = await promptSecretValue(name);
        } catch {
          console.error("Error: failed to read secret value.");
          process.exit(1);
        }
        if (!value) {
          console.error("Error: empty value, nothing stored.");
          process.exit(1);
        }
        const result = await ctx.client.secrets.set(name, value, scope);
        if (!result.ok) {
          console.error(`Error: failed to store secret "${name}"${result.message ? `: ${result.message}` : "."}`);
          process.exit(1);
        }
        console.log(`Secret "${name}" stored (${scope} scope).`);
      });

    cmd
      .command("get <name>")
      .description("Retrieve and display a secret value")
      .action(async (name: string) => {
        const result = await ctx.client.secrets.get(name);
        if (!result.found) {
          console.error(`Secret "${name}" not found.`);
          process.exit(1);
        }
        // Print to stdout (for piping), trailing newline only on TTY
        process.stdout.write(result.value);
        if (process.stdout.isTTY) process.stdout.write("\n");
      });

    cmd
      .command("list")
      .description("List available secret names (not values)")
      .action(async () => {
        const result = await ctx.client.secrets.list();
        if (result.secrets.length === 0) {
          console.log("No secrets configured.");
          console.log("Use 'kota secrets set <name>' to add one.");
          return;
        }
        console.log(`${"Name".padEnd(30)} Source`);
        console.log("-".repeat(50));
        for (const s of result.secrets) {
          console.log(`${s.name.padEnd(30)} ${s.source}`);
        }
      });

    cmd
      .command("remove <name>")
      .description("Remove a secret")
      .option("-g, --global", "Remove from global scope")
      .option("-p, --project", "Remove from project scope")
      .action(async (name: string, opts) => {
        const scope = parseScope(opts);
        const result = await ctx.client.secrets.remove(name, scope);
        if (result.ok) {
          console.log(`Secret "${name}" removed (${scope} scope).`);
          return;
        }
        if (result.reason === "not_found") {
          console.error(`Secret "${name}" not found in ${scope} scope.`);
        } else {
          console.error(`Error: failed to remove secret "${name}"${result.message ? `: ${result.message}` : "."}`);
        }
        process.exit(1);
      });

    return [cmd];
  },

  skills: [{ name: "secrets", promptPath: "src/modules/secrets/secrets.md" }],

  localClient: (ctx) => {
    const handler: SecretsClient = {
      async list() {
        return { secrets: ensureLocalStore(ctx).list() };
      },
      async get(name) {
        const value = ensureLocalStore(ctx).get(name);
        return value === null ? { found: false } : { found: true, value };
      },
      async set(name, value, scope) {
        try {
          ensureLocalStore(ctx).set(name, value, scope);
          return { ok: true };
        } catch (err) {
          return { ok: false, reason: "store_error", message: (err as Error).message };
        }
      },
      async remove(name, scope) {
        try {
          if (!ensureLocalStore(ctx).remove(name, scope)) {
            return { ok: false, reason: "not_found" };
          }
          return { ok: true };
        } catch (err) {
          return { ok: false, reason: "store_error", message: (err as Error).message };
        }
      },
    };
    return { secrets: handler };
  },

  daemonClient: (link) => ({ secrets: buildSecretsDaemonHandler(link) }),

  onLoad: (ctx) => {
    initSecretStore(ctx.cwd);
  },
};

/**
 * Daemon-side `SecretsClient` backed by the typed `DaemonTransport`. Calls
 * the same `/api/secrets` and `/api/secrets/:name` HTTP routes the secrets
 * module registers through `secretsRoutes`. The transport surface owns the
 * bearer token, base URL, and timeout policy — this factory only encodes
 * the wire shape.
 *
 * `list()` collapses any non-`200` (the typed link returns `null` on a
 * missing-route or transport error) into `{ secrets: [] }`, matching the
 * pre-migration central closure's `result?.secrets ?? []`. `get(name)`
 * collapses `null` (404 or other transport silence) into `{ found: false }`,
 * matching the prior `silent fallthrough on transport errors` behavior.
 * `set(name, value, scope)` and `remove(name, scope)` thread `PUT` and
 * `DELETE` verbs respectively; thrown transport errors collapse into
 * `{ ok: false, reason: "store_error", message }` with the underlying
 * error message preserved, while `remove`'s `null` (404) collapses into
 * `{ ok: false, reason: "not_found" }`. Every per-secret path runs through
 * `encodeURIComponent(name)`, and the `DELETE` query string runs the
 * scope through `encodeURIComponent(scope)`, so embedded slashes,
 * percents, or spaces round-trip safely.
 */
function buildSecretsDaemonHandler(link: DaemonTransport): SecretsClient {
  return {
    list: async (): Promise<SecretListResult> => {
      const result = await link.request<SecretListResult>("GET", "/api/secrets");
      return { secrets: result?.secrets ?? [] };
    },
    get: async (name): Promise<SecretGetResult> => {
      const result = await link.request<{ found: true; value: string }>(
        "GET",
        `/api/secrets/${encodeURIComponent(name)}`,
      );
      return result ? { found: true, value: result.value } : { found: false };
    },
    set: async (name, value, scope): Promise<SecretMutateResult> => {
      try {
        await link.requestStrict<{ ok: true }>(
          "PUT",
          `/api/secrets/${encodeURIComponent(name)}`,
          { value, scope },
        );
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: "store_error", message: (err as Error).message };
      }
    },
    remove: async (name, scope): Promise<SecretMutateResult> => {
      try {
        const result = await link.request<{ ok: true }>(
          "DELETE",
          `/api/secrets/${encodeURIComponent(name)}?scope=${encodeURIComponent(scope)}`,
        );
        return result ? { ok: true } : { ok: false, reason: "not_found" };
      } catch (err) {
        return { ok: false, reason: "store_error", message: (err as Error).message };
      }
    },
  };
}

export default secretsModule;
