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
  type ColumnsNode,
  columns,
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
      print(buildSkillListNode(result.skills));
    });

  skillCmd
    .command("import <source>")
    .description("Install a skill from a URL, GitHub pack, local directory, or local file into .kota/skills/")
    .option("--name <name>", "Override the skill name (and filename)")
    .option("--skill <name>", "Select one skill from a pack source")
    .option("--all", "Import every skill from a pack source")
    .action(async (source: string, opts: { name?: string; skill?: string; all?: boolean }) => {
      const result = await ctx.client.skills.import(
        source,
        {
          ...(opts.name !== undefined && { name: opts.name }),
          ...(opts.skill !== undefined && { skill: opts.skill }),
          ...(opts.all !== undefined && { all: opts.all }),
        },
      );
      if (!result.ok) {
        console.error(`Error: ${result.message}`);
        process.exit(1);
      }
      if (result.skills.length === 1) {
        const installed = result.skills[0];
        print(line(
          span("Installed skill ", "success"),
          span(`'${installed.name}'`, "accent"),
          plain(" -> "),
          span(installed.path, "muted"),
        ));
        return;
      }
      print(stack(
        line(span(`Installed ${result.skills.length} skills:`, "success")),
        ...result.skills.map((installed) =>
          line(
            plain("  "),
            span(installed.name, "accent"),
            plain(" -> "),
            span(installed.path, "muted"),
          )
        ),
      ));
    });

  return skillCmd;
}

export function buildSkillListNode(skills: SkillSummary[]): ColumnsNode {
  return columns(
    [
      { header: "Name", role: "accent" },
      { header: "Src", role: "info" },
      { header: "Use" },
      { header: "Resources", maxWidth: 24 },
      { header: "Provenance", maxWidth: 48 },
      { header: "Description", maxWidth: 72 },
    ],
    skills.map((s) => ({
      cells: [
        { spans: [{ text: s.name, role: "accent" }] },
        { spans: [{ text: s.source, role: "info" }] },
        { spans: [{ text: s.shadowedBy ? `shadowed by ${s.shadowedBy}` : s.activation }] },
        { spans: [{ text: s.resourceSummary ?? "" }] },
        { spans: [{ text: s.provenance ?? "" }] },
        { spans: [{ text: s.description ?? "" }] },
      ],
    })),
  );
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
        ...(options?.skill !== undefined && { skill: options.skill }),
        ...(options?.all !== undefined && { all: options.all }),
      }),
  };
}

export default skillsModule;
