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
import { blank, json, line, plain, span, stack } from "#modules/rendering/primitives.js";
import { print, printToStderr, writeJson, writeStdoutLine } from "#modules/rendering/transport.js";
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

function writeConfigValueJson(value: Extract<ConfigGetResult, { found: true }>["value"]): void {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new TypeError("Cannot write undefined config value as JSON output");
  }
  writeStdoutLine(serialized);
}

export function buildConfigCommand(ctx: ModuleContext): Command {
  const cmd = new Command("config").description("Inspect and validate KOTA configuration");

  cmd
    .command("validate")
    .description("Validate and print the resolved merged config")
    .option("--json", "Output only the resolved config as JSON")
    .action(async (opts: { json?: boolean }) => {
      const result = await ctx.client.config.validate();

      if (opts.json) {
        writeJson(result.resolved, { pretty: true });
        return;
      }

      if (result.sources.length === 0) {
        print(line(plain("Config sources: "), span("(none found — using defaults)", "muted")));
      } else {
        print(stack(
          line(span("Config sources:", "info", true)),
          ...result.sources.map(({ label, path }) =>
            line(span(label, "muted"), plain("  "), span(path, "accent"))
          ),
        ));
      }

      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          printToStderr(line(span(`Warning: ${w}`, "warn")));
        }
      }

      print(stack(blank(), line(span("Resolved config:", "info", true)), json(result.resolved)));
    });

  cmd
    .command("get <key>")
    .description("Print the value of a config key from the resolved merged config")
    .action(async (key: string) => {
      const result = await ctx.client.config.get(key);
      if (!result.found) {
        printToStderr(line(span(`Error: key "${key}" not found in resolved config`, "error")));
        process.exit(1);
      }
      if (typeof result.value === "string") {
        writeStdoutLine(result.value);
      } else {
        writeConfigValueJson(result.value);
      }
    });

  cmd
    .command("set <key> <value>")
    .description("Set a config key in the project-level .kota/config.json")
    .action(async (key: string, value: string) => {
      const result = await ctx.client.config.set(key, value);
      if (result.unknownKey) {
        printToStderr(line(span(`Warning: "${result.topKey}" is not a recognised config key`, "warn")));
      }
    });

  cmd
    .command("schema")
    .description("Print the path to the kota-config JSON Schema file")
    .option("--print", "Print the schema content instead of the path")
    .action(async (opts: { print?: boolean }) => {
      if (opts.print) {
        const result = await ctx.client.config.schemaContent();
        writeStdoutLine(result.content);
      } else {
        const result = await ctx.client.config.schemaPath();
        writeStdoutLine(result.path);
      }
    });

  return cmd;
}

const configModule: KotaModule = {
  name: "config",
  version: "1.0.0",
  description: "Config CLI surface — kota config get/set/validate/schema",
  dependencies: ["rendering"],
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
