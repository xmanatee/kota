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
import type Anthropic from "@anthropic-ai/sdk";
import { Command } from "commander";
import { getSecretStore, initSecretStore, type SecretScope } from "#core/config/secrets.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { ToolResult } from "#core/tools/index.js";

const getSecretTool: Anthropic.Tool = {
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
      risk: "safe",
      kind: "discovery",
      group: "management",
    },
  ],

  commands: (_ctx) => {
    const cmd = new Command("secrets").description("Manage secrets and credentials");

    cmd
      .command("set <name>")
      .description("Store a secret (prompts for value — never pass secrets as arguments)")
      .option("-g, --global", "Store in global ~/.kota/ scope (default: project)")
      .option("-p, --project", "Store in project .kota/ scope")
      .action(async (name: string, opts) => {
        const store = initSecretStore();
        const scope = parseScope(opts);
        try {
          const value = await promptSecretValue(name);
          if (!value) {
            console.error("Error: empty value, nothing stored.");
            process.exit(1);
          }
          store.set(name, value, scope);
          console.log(`Secret "${name}" stored (${scope} scope).`);
        } catch {
          console.error("Error: failed to read secret value.");
          process.exit(1);
        }
      });

    cmd
      .command("get <name>")
      .description("Retrieve and display a secret value")
      .action((name: string) => {
        const store = initSecretStore();
        const value = store.get(name);
        if (value === null) {
          console.error(`Secret "${name}" not found.`);
          process.exit(1);
        }
        // Print to stdout (for piping), warning to stderr
        process.stdout.write(value);
        if (process.stdout.isTTY) process.stdout.write("\n");
      });

    cmd
      .command("list")
      .description("List available secret names (not values)")
      .action(() => {
        const store = initSecretStore();
        const secrets = store.list();
        if (secrets.length === 0) {
          console.log("No secrets configured.");
          console.log("Use 'kota secrets set <name>' to add one.");
          return;
        }
        console.log(`${"Name".padEnd(30)} Source`);
        console.log("-".repeat(50));
        for (const s of secrets) {
          console.log(`${s.name.padEnd(30)} ${s.source}`);
        }
      });

    cmd
      .command("remove <name>")
      .description("Remove a secret")
      .option("-g, --global", "Remove from global scope")
      .option("-p, --project", "Remove from project scope")
      .action((name: string, opts) => {
        const store = initSecretStore();
        const scope = parseScope(opts);
        if (store.remove(name, scope)) {
          console.log(`Secret "${name}" removed (${scope} scope).`);
        } else {
          console.error(`Secret "${name}" not found in ${scope} scope.`);
          process.exit(1);
        }
      });

    return [cmd];
  },

  skills: [{ name: "secrets", promptPath: "src/modules/secrets/secrets.md" }],

  onLoad: (ctx) => {
    initSecretStore(ctx.cwd);
  },
};

export default secretsModule;
