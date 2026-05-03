/**
 * Skill ops module — owns the `kota skill` CLI surface.
 *
 * Skills are contributed by other modules via `KotaModule.skills`.
 * This module registers the operator CLI for inspecting and managing them.
 * Imported skills are stored in `.kota/skills/` and shown in `skill list`.
 */

import { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import {
  type LineNode,
  line,
  plain,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import type {
  SkillImportOptions,
  SkillImportResult,
  SkillSummary,
  SkillsClient,
  SkillsListResult,
} from "./client.js";
import { skillControlRoutes } from "./routes.js";
import { importSkill, listSkills } from "./skill-ops-operations.js";

function buildSkillCommand(ctx: ModuleContext): Command {
  const skillCmd = new Command("skill").description("Manage and inspect registered skills");

  skillCmd
    .command("list")
    .description("List all registered skills with source module")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const result = await ctx.client.skills.list();
      if (opts.json) {
        // biome-ignore lint/suspicious/noConsole: structured JSON output path stays on console
        console.log(JSON.stringify(result.skills, null, 2));
        return;
      }
      if (result.skills.length === 0) {
        print(line(plain("No skills registered.")));
        return;
      }
      print(stack(...buildSkillListLines(result.skills)));
    });

  skillCmd
    .command("import <source>")
    .description("Install a skill from a URL or local file path into .kota/skills/")
    .option("--name <name>", "Override the skill name (and filename)")
    .action(async (source: string, opts: { name?: string }) => {
      const result = await ctx.client.skills.import(
        source,
        opts.name !== undefined ? { name: opts.name } : undefined,
      );
      if (!result.ok) {
        console.error(`Error: ${result.message}`);
        process.exit(1);
      }
      print(line(
        span("Installed skill ", "success"),
        span(`'${result.name}'`, "accent"),
        plain(" → "),
        span(result.path, "muted"),
      ));
    });

  return skillCmd;
}

export function buildSkillListLines(skills: SkillSummary[]): LineNode[] {
  const nameWidth = Math.max(...skills.map((s) => s.name.length), 4);
  const srcWidth = Math.max(...skills.map((s) => s.source.length), 6);
  const header = line(span(
    `${"Name".padEnd(nameWidth)}  ${"Source".padEnd(srcWidth)}  Description`,
    "muted",
    true,
  ));
  const rule = line(span("-".repeat(nameWidth + srcWidth + 16), "muted"));
  const rows: LineNode[] = skills.map((s) => line(
    span(s.name.padEnd(nameWidth), "accent"),
    plain("  "),
    span(s.source.padEnd(srcWidth), "info"),
    plain(`  ${s.description ?? ""}`),
  ));
  return [header, rule, ...rows];
}

const skillsModule: KotaModule = {
  name: "skill-ops",
  version: "1.0.0",
  description: "Operator CLI for inspecting and importing registered skills",
  dependencies: ["rendering"],
  commands: (ctx: ModuleContext) => [buildSkillCommand(ctx)],
  controlRoutes: (ctx) => skillControlRoutes(ctx),
  localClient: (ctx) => {
    const skills: SkillsClient = {
      async list() {
        return listSkills(ctx);
      },
      async import(source, options) {
        return importSkill(ctx, source, options);
      },
    };
    return { skills };
  },

  daemonClient: (link: DaemonTransport) => ({
    skills: buildSkillsDaemonHandler(link),
  }),
};

/**
 * Daemon-side `SkillsClient` backed by the typed `DaemonTransport`. Both
 * methods issue a single strict request against the routes the skill-ops
 * module registers through `controlRoutes` and decode the canonical
 * envelope the daemon emits — no special-cased status translation,
 * matching every other migrated namespace's strict-transport posture.
 * The `import` not-ok arms (`fetch_failed`, `missing_name`) ride a
 * uniform 200 response carrying the `SkillImportResult` discriminated
 * union; the daemon route is the source of truth for the `ok` flag.
 */
function buildSkillsDaemonHandler(link: DaemonTransport): SkillsClient {
  return {
    list: async (): Promise<SkillsListResult> =>
      link.requestStrict<SkillsListResult>("GET", "/skills"),
    import: async (
      source: string,
      options?: SkillImportOptions,
    ): Promise<SkillImportResult> =>
      link.requestStrict<SkillImportResult>("POST", "/skills/import", {
        source,
        ...(options?.name !== undefined && { name: options.name }),
      }),
  };
}

export default skillsModule;
