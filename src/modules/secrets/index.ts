/**
 * Secrets module — secure credential management with output masking.
 *
 * Registers:
 * - `kota secrets set/get/list/remove` CLI commands
 * - `get_secret` agent tool (injects into env, returns placeholder to LLM)
 *
 * Every operation resolves one project-owned store from its validated scope.
 */
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { Command } from "commander";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { getProjectSecretStore } from "#core/config/secrets.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { credentialInjectionEffect } from "#core/tools/effect.js";
import type { ToolResult, ToolRunnerContext } from "#core/tools/index.js";
import { injectSessionEnvironmentVariable } from "#core/tools/session-environment.js";
import { columns, line, plain, span, stack } from "#modules/rendering/primitives.js";
import { print, printToStderr, writeStdout } from "#modules/rendering/transport.js";
import {
  secretMutationFailure,
  type SecretScope,
  type SecretsClient,
} from "./client.js";
import { buildSecretsDaemonHandler } from "./daemon-client.js";
import {
  createSecretProjectStores,
  requireSecretStore,
  type SecretProjectStores,
} from "./project-scope.js";
import { secretsRoutes } from "./routes.js";

const getSecretTool: KotaTool = {
  name: "get_secret",
  description:
    "Retrieve a secret (API key, token, credential) and inject it into this session's execution environment. " +
    "The actual value is available only to shell/code_exec tools in the same project and session. " +
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

function makeGetSecretRunner(
  ctx: ModuleContext,
  projectStores: SecretProjectStores,
) {
  return async (
    input: Record<string, unknown>,
    runnerContext?: ToolRunnerContext,
  ): Promise<ToolResult> => {
    const name = input.name as string;
    if (!name || typeof name !== "string") {
      return { content: "Error: secret name is required", is_error: true };
    }

    const store = requireSecretStore(projectStores, {
      ...(runnerContext?.scopeId !== undefined
        ? { scopeId: runnerContext.scopeId }
        : {}),
      ...(runnerContext?.projectId !== undefined
        ? { projectId: runnerContext.projectId }
        : {}),
    });
    const value = store.get(name);
    if (value === null) {
      const available = store.list().map((secret) => secret.name);
      const hint = available.length > 0
        ? `\nAvailable secrets: ${available.join(", ")}`
        : "\nNo secrets configured. Use 'kota secrets set <name>' to add one.";
      return { content: `Secret "${name}" not found.${hint}`, is_error: true };
    }

    injectSessionEnvironmentVariable(runnerContext ?? {}, name, value);
    ctx.log.debug(`Secret "${name}" injected into the session environment`);

    return {
      content: `Secret "${name}" injected into this session's environment as $${name}. Value: <secret:${name}>`,
    };
  };
}

type SecretPromptInput = Readable & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => SecretPromptInput;
};

type SecretPromptStreams = {
  input?: SecretPromptInput;
  output?: Writable;
};

type RawModeSecretPromptInput = SecretPromptInput & {
  setRawMode: (mode: boolean) => SecretPromptInput;
};

function isRawModeTtyInput(input: SecretPromptInput): input is RawModeSecretPromptInput {
  return input.isTTY === true && typeof input.setRawMode === "function";
}

function withoutLastChar(value: string): string {
  const chars = Array.from(value);
  chars.pop();
  return chars.join("");
}

function isPrintableCharacter(char: string): boolean {
  return char >= " " && char !== "\u007f" && char !== "\u001b";
}

function promptSecretValueFromLine(
  name: string,
  input: SecretPromptInput,
  output: Writable,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input, output });
    let settled = false;

    output.write(`Enter value for "${name}": `);

    rl.on("line", (line) => {
      settled = true;
      rl.close();
      resolve(line.trim());
    });
    rl.on("close", () => {
      if (!settled) reject(new Error("Input cancelled"));
    });
    rl.on("error", reject);
  });
}

function promptSecretValueFromTty(
  name: string,
  input: RawModeSecretPromptInput,
  output: Writable,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = "";
    let settled = false;
    let skippingEscapeSequence = false;
    const wasRaw = input.isRaw === true;
    let rawModeEnabled = false;

    const cleanup = () => {
      input.off("data", onData);
      input.off("error", onError);
      if (rawModeEnabled && !wasRaw) input.setRawMode(false);
      output.write("\n");
    };

    const settle = (result: { value: string } | { error: Error }) => {
      if (settled) return;
      settled = true;
      cleanup();
      if ("error" in result) {
        reject(result.error);
        return;
      }
      resolve(result.value.trim());
    };

    const onError = (err: Error) => settle({ error: err });

    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const char of text) {
        if (char === "\u0003" || char === "\u0004") {
          settle({ error: new Error("Input cancelled") });
          return;
        }
        if (char === "\r" || char === "\n") {
          settle({ value });
          return;
        }
        if (char === "\b" || char === "\u007f") {
          value = withoutLastChar(value);
          continue;
        }
        if (char === "\u001b") {
          skippingEscapeSequence = true;
          continue;
        }
        if (skippingEscapeSequence) {
          if (/^[A-Za-z~]$/.test(char)) skippingEscapeSequence = false;
          continue;
        }
        if (isPrintableCharacter(char)) value += char;
      }
    };

    output.write(`Enter value for "${name}": `);
    try {
      input.setRawMode(true);
      rawModeEnabled = true;
      input.resume();
      input.on("data", onData);
      input.on("error", onError);
    } catch (err) {
      settle({ error: err instanceof Error ? err : new Error(String(err)) });
    }
  });
}

/** Prompt the user for a secret value on stdin, hiding TTY input when possible. */
export function promptSecretValue(
  name: string,
  streams: SecretPromptStreams = {},
): Promise<string> {
  const input: SecretPromptInput = streams.input ?? process.stdin;
  const output = streams.output ?? process.stderr;
  if (isRawModeTtyInput(input)) {
    return promptSecretValueFromTty(name, input, output);
  }
  return promptSecretValueFromLine(name, input, output);
}

function parseScope(opts: { global?: boolean; project?: boolean }): SecretScope {
  if (opts.global) return "global";
  return "project";
}

function printSecretError(message: string): void {
  printToStderr(line(span(message, "error")));
}

const secretsModule: KotaModule = {
  name: "secrets",
  version: "1.0.0",
  description: "Secure credential management with output masking",
  dependencies: ["rendering"],

  tools: (ctx) => {
    const projectStores = createSecretProjectStores(ctx.cwd);
    return [
      {
        tool: getSecretTool,
        runner: makeGetSecretRunner(ctx, projectStores),
        effect: credentialInjectionEffect(),
        group: "management",
      },
    ];
  },

  routes: (ctx) => secretsRoutes(createSecretProjectStores(ctx.cwd)),

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
          printSecretError("Error: failed to read secret value.");
          process.exit(1);
        }
        if (!value) {
          printSecretError("Error: empty value, nothing stored.");
          process.exit(1);
        }
        const result = await ctx.client.secrets.set(name, value, scope);
        if (!result.ok) {
          printSecretError(`Error: failed to store secret "${name}"${result.message ? `: ${result.message}` : "."}`);
          process.exit(1);
        }
        print(line(span(`Secret "${name}" stored`, "success"), plain(` (${scope} scope).`)));
      });

    cmd
      .command("get <name>")
      .description("Retrieve and display a secret value")
      .action(async (name: string) => {
        const result = await ctx.client.secrets.get(name);
        if (!result.found) {
          printSecretError(`Secret "${name}" not found.`);
          process.exit(1);
        }
        // Print to stdout (for piping), trailing newline only on TTY
        writeStdout(result.value);
        if (process.stdout.isTTY) writeStdout("\n");
      });

    cmd
      .command("list")
      .description("List available secret names (not values)")
      .action(async () => {
        const result = await ctx.client.secrets.list();
        if (result.secrets.length === 0) {
          print(stack(
            line(plain("No secrets configured.")),
            line(plain("Use 'kota secrets set <name>' to add one.")),
          ));
          return;
        }
        print(columns(
          [
            { header: "Name", role: "accent", maxWidth: 50 },
            { header: "Source", role: "muted", minWidth: 7 },
          ],
          result.secrets.map((s) => ({
            cells: [
              { spans: [{ text: s.name, role: "accent" }] },
              { spans: [{ text: s.source, role: "muted" }] },
            ],
          })),
        ));
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
          print(line(span(`Secret "${name}" removed`, "success"), plain(` (${scope} scope).`)));
          return;
        }
        if (result.reason === "not_found") {
          printSecretError(`Secret "${name}" not found in ${scope} scope.`);
        } else {
          printSecretError(`Error: failed to remove secret "${name}"${result.message ? `: ${result.message}` : "."}`);
        }
        process.exit(1);
      });

    return [cmd];
  },

  skills: [{ name: "secrets", promptPath: "src/modules/secrets/secrets.md" }],

  localClient: (ctx) => {
    const projectStores = createSecretProjectStores(ctx.cwd);
    const handler: SecretsClient = {
      async list(project) {
        return { secrets: requireSecretStore(projectStores, project).list() };
      },
      async get(name, project) {
        const value = requireSecretStore(projectStores, project).get(name);
        return value === null ? { found: false } : { found: true, value };
      },
      async set(name, value, scope, project) {
        try {
          requireSecretStore(projectStores, project).set(name, value, scope);
          return { ok: true };
        } catch (error) {
          return secretMutationFailure(error);
        }
      },
      async remove(name, scope, project) {
        try {
          if (!requireSecretStore(projectStores, project).remove(name, scope)) {
            return { ok: false, reason: "not_found" };
          }
          return { ok: true };
        } catch (error) {
          return secretMutationFailure(error);
        }
      },
    };
    return { secrets: handler };
  },

  daemonClient: (link) => ({ secrets: buildSecretsDaemonHandler(link) }),

  onLoad: (ctx) => {
    getProjectSecretStore(ctx.cwd);
  },
};

export default secretsModule;
