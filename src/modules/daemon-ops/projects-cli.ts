/**
 * `kota project` operator subcommands.
 *
 * `ls` lists configured projects, marks the default, and points at the
 * currently active selection (or "—" when no selection is in force).
 * `use` switches the daemon's active selection so subsequent inspection
 * calls without `--project` scope to that project. Pass `--clear` to
 * reset the selection back to the registry default.
 *
 * Output flows through the rendering module so the table degrades cleanly
 * on a non-TTY pipe and matches the rest of `daemon-ops` chrome.
 */

import { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { columns, line, plain, type RenderNode, span } from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import type { ProjectsListResult } from "./client.js";

function buildProjectsListNode(result: Extract<ProjectsListResult, { ok: true }>): RenderNode {
  if (result.projects.length === 0) {
    return line(span("No projects configured.", "muted"));
  }
  const rows = result.projects.map((p) => {
    const isActive = result.activeProjectId === p.projectId;
    const isDefault = result.defaultProjectId === p.projectId;
    const markers: string[] = [];
    if (isActive) markers.push("active");
    if (isDefault) markers.push("default");
    const marker = markers.length > 0 ? `(${markers.join(", ")})` : "";
    return {
      cells: [
        { spans: [span(p.projectId, isActive ? "tool" : "muted", isActive)] },
        { spans: [plain(p.displayName)] },
        { spans: [span(p.projectDir, "muted")] },
        { spans: [span(marker, isActive ? "info" : "muted")] },
      ],
    };
  });
  return columns(
    [
      { header: "ID", role: "muted", headerRole: "muted", minWidth: 8 },
      { header: "Name", minWidth: 12 },
      { header: "Path", role: "muted", headerRole: "muted", minWidth: 16 },
      { header: "", headerRole: "muted", minWidth: 8 },
    ],
    rows,
  );
}

export function buildProjectCommand(ctx: ModuleContext): Command {
  const cmd = new Command("project").description(
    "Inspect and select the daemon's active project",
  );

  cmd
    .command("ls")
    .description("List configured projects and mark the active one")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const result = await ctx.client.projects.list();
      if (!result.ok) {
        if (opts.json) {
          console.log(JSON.stringify(result));
        } else {
          console.error("Daemon is not running. `kota project` requires a live daemon.");
        }
        process.exitCode = 1;
        return;
      }
      if (opts.json) {
        console.log(
          JSON.stringify({
            projects: result.projects,
            defaultProjectId: result.defaultProjectId,
            activeProjectId: result.activeProjectId,
          }),
        );
        return;
      }
      print(buildProjectsListNode(result));
    });

  cmd
    .command("use [projectId]")
    .description(
      "Switch the daemon's active project. Pass --clear to reset to the registry default.",
    )
    .option("--clear", "Clear the active selection (route fall back to default)")
    .option("--json", "Output as JSON")
    .action(async (
      projectId: string | undefined,
      opts: { clear?: boolean; json?: boolean },
    ) => {
      if (opts.clear && projectId) {
        console.error("Cannot pass both <projectId> and --clear.");
        process.exitCode = 1;
        return;
      }
      if (!opts.clear && !projectId) {
        console.error("Pass <projectId> to switch, or --clear to reset.");
        process.exitCode = 1;
        return;
      }
      const target = opts.clear ? null : projectId!;
      const result = await ctx.client.projects.use(target);
      if (!result.ok) {
        if (opts.json) {
          console.log(JSON.stringify(result));
        } else if (result.reason === "not_found") {
          console.error(`Unknown project: "${result.projectId}".`);
        } else {
          console.error("Daemon is not running. `kota project use` requires a live daemon.");
        }
        process.exitCode = 1;
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify(result));
        return;
      }
      if (result.activeProjectId === null) {
        console.log("Active selection cleared. Routes fall back to the registry default.");
      } else {
        console.log(`Active project → ${result.activeProjectId}`);
      }
    });

  return cmd;
}
