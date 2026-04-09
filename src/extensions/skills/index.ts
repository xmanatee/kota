/**
 * Skills extension — owns the `kota skill` CLI surface.
 *
 * Skills are contributed by other extensions via `KotaExtension.skills`.
 * This extension registers the operator CLI for inspecting them.
 */

import { Command } from "commander";
import type { SkillDef } from "../../agent-types.js";
import type { ExtensionContext, KotaExtension } from "../../extension-types.js";

function buildSkillCommand(ctx: ExtensionContext): Command {
  const skillCmd = new Command("skill").description("Inspect registered skills");

  skillCmd
    .command("list")
    .description("List all registered skills with source extension")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const summaries = ctx.getExtensionSummaries();
      type SkillEntry = SkillDef & { source: string };
      const skills: SkillEntry[] = [];
      for (const summary of summaries) {
        for (const skill of summary.skills) {
          skills.push({ ...skill, source: summary.name });
        }
      }
      if (opts.json) {
        console.log(JSON.stringify(skills, null, 2));
        return;
      }
      if (skills.length === 0) {
        console.log("No skills registered.");
        return;
      }
      const nameWidth = Math.max(...skills.map((s) => s.name.length), 4);
      const srcWidth = Math.max(...skills.map((s) => s.source.length), 6);
      console.log(`${"Name".padEnd(nameWidth)}  ${"Source".padEnd(srcWidth)}  Description`);
      console.log("-".repeat(nameWidth + srcWidth + 16));
      for (const s of skills) {
        const desc = s.description ?? "";
        console.log(`${s.name.padEnd(nameWidth)}  ${s.source.padEnd(srcWidth)}  ${desc}`);
      }
    });

  return skillCmd;
}

const skillsModule: KotaExtension = {
  name: "skills",
  version: "1.0.0",
  description: "Operator CLI for inspecting registered skills",
  commands: (ctx: ExtensionContext) => [buildSkillCommand(ctx)],
};

export default skillsModule;
