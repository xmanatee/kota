/**
 * Config module — owns the `kota config` CLI surface.
 *
 * Registers subcommands: validate, get, set, schema. Every subcommand
 * routes through `ctx.client.config.<method>()` so daemon-up and
 * daemon-down operators read and mutate config the same way.
 */

import { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  ConfigClient,
  ConfigGetResult,
  ConfigSetResult,
  ConfigValidateResult,
} from "./client.js";
import { configControlRoutes } from "./config-control-routes.js";
import {
  configSchemaContent,
  configSchemaPath,
  getConfigValue,
  setConfigValue,
  validateConfig,
} from "./config-operations.js";
import { handleGetConfig } from "./routes.js";

export function buildConfigCommand(ctx: ModuleContext): Command {
  const cmd = new Command("config").description("Inspect and validate KOTA configuration");

  cmd
    .command("validate")
    .description("Validate and print the resolved merged config")
    .option("--json", "Output only the resolved config as JSON")
    .action(async (opts: { json?: boolean }) => {
      const result = await ctx.client.config.validate();

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.resolved, null, 2)}\n`);
        return;
      }

      if (result.sources.length === 0) {
        console.log("Config sources: (none found — using defaults)");
      } else {
        console.log("Config sources:");
        for (const { label, path } of result.sources) {
          console.log(`  ${label.padEnd(7)} ${path}`);
        }
      }
      console.log();

      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          console.error(`Warning: ${w}`);
        }
        console.log();
      }

      console.log("Resolved config:");
      console.log(JSON.stringify(result.resolved, null, 2));
    });

  cmd
    .command("get <key>")
    .description("Print the value of a config key from the resolved merged config")
    .action(async (key: string) => {
      const result = await ctx.client.config.get(key);
      if (!result.found) {
        console.error(`Error: key "${key}" not found in resolved config`);
        process.exit(1);
      }
      if (typeof result.value === "string") {
        process.stdout.write(`${result.value}\n`);
      } else {
        process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
      }
    });

  cmd
    .command("set <key> <value>")
    .description("Set a config key in the project-level .kota/config.json")
    .action(async (key: string, value: string) => {
      const result = await ctx.client.config.set(key, value);
      if (result.unknownKey) {
        console.error(`Warning: "${result.topKey}" is not a recognised config key`);
      }
    });

  cmd
    .command("schema")
    .description("Print the path to the kota-config JSON Schema file")
    .option("--print", "Print the schema content instead of the path")
    .action(async (opts: { print?: boolean }) => {
      if (opts.print) {
        const result = await ctx.client.config.schemaContent();
        process.stdout.write(`${result.content}\n`);
      } else {
        const result = await ctx.client.config.schemaPath();
        process.stdout.write(`${result.path}\n`);
      }
    });

  return cmd;
}

const configModule: KotaModule = {
  name: "config",
  version: "1.0.0",
  description: "Config CLI surface — kota config get/set/validate/schema",
  commands: (ctx) => [buildConfigCommand(ctx)],
  routes: (ctx) => [
    { method: "GET", path: "/api/config", handler: (_req, res) => handleGetConfig(res, ctx.config) },
  ],
  controlRoutes: (ctx) => configControlRoutes(ctx),
  localClient: (ctx) => {
    const config: ConfigClient = {
      async validate() {
        return validateConfig(ctx.cwd, ctx.getRegisteredConfigKeys());
      },
      async get(key) {
        return getConfigValue(ctx.cwd, key);
      },
      async set(key, rawValue) {
        return setConfigValue(ctx.cwd, ctx.getRegisteredConfigKeys(), key, rawValue);
      },
      async schemaPath() {
        return { path: configSchemaPath() };
      },
      async schemaContent() {
        return { content: configSchemaContent() };
      },
    };
    return { config };
  },
  daemonClient: (link) => ({ config: buildConfigDaemonHandler(link) }),
};

/**
 * Daemon-side `ConfigClient` backed by the typed `DaemonTransport`. Calls
 * the `/config/validate`, `/config/value`, `/config/schema-path`, and
 * `/config/schema` control routes the daemon owns.
 *
 *  - `validate()` calls `link.request<ConfigValidateResult>("GET",
 *    "/config/validate")`. On `null` (transport failure or non-ok response)
 *    it throws `"Daemon unreachable while validating config"`. On success
 *    it returns the typed body verbatim.
 *  - `get(key)` uses `link.fetchRaw` so the `404 → { found: false, reason:
 *    "not_found" }` arm is distinguishable from generic transport failure.
 *    On non-ok statuses other than 404 it throws the daemon's `error` field
 *    (or `HTTP <status>` when no error body is parseable).
 *  - `set(key, rawValue)` PUTs `/config/value` with a JSON body via
 *    `link.fetchRaw`. The daemon's `Authorization` header is attached
 *    automatically by the link.
 *  - `schemaPath()` and `schemaContent()` are pure GETs through
 *    `link.request<T>` and throw `"Daemon unreachable …"` on `null`.
 */
function buildConfigDaemonHandler(link: DaemonTransport): ConfigClient {
  return {
    validate: async () => {
      const result = await link.request<ConfigValidateResult>(
        "GET",
        "/config/validate",
      );
      if (!result) throw new Error("Daemon unreachable while validating config");
      return result;
    },
    get: async (key: string) => {
      const res = await link.fetchRaw(
        `/config/value?key=${encodeURIComponent(key)}`,
        { method: "GET" },
      );
      if (res.status === 404) return { found: false, reason: "not_found" };
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as ConfigGetResult;
    },
    set: async (key: string, rawValue: string) => {
      const res = await link.fetchRaw("/config/value", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...link.authHeaders() },
        body: JSON.stringify({ key, rawValue }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as ConfigSetResult;
    },
    schemaPath: async () => {
      const result = await link.request<{ path: string }>(
        "GET",
        "/config/schema-path",
      );
      if (!result) {
        throw new Error("Daemon unreachable while reading config schema path");
      }
      return result;
    },
    schemaContent: async () => {
      const result = await link.request<{ content: string }>(
        "GET",
        "/config/schema",
      );
      if (!result) {
        throw new Error("Daemon unreachable while reading config schema content");
      }
      return result;
    },
  };
}

export default configModule;
