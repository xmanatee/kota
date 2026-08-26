import { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { blank, line, span, stack, statusBanner } from "#modules/rendering/primitives.js";
import { print, writeJson } from "#modules/rendering/transport.js";
import type { UiActionExecutionResult, UiJsonValue } from "./operator-ui.js";
import { findUiAction, renderUiSurface } from "./operator-ui.js";

function parseParameters(raw: string | undefined): UiJsonValue | undefined {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as UiJsonValue;
  } catch (err) {
    throw new Error(`--params must be valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function printActionResult(result: UiActionExecutionResult): void {
  if (result.ok) {
    print(statusBanner("success", "UI action executed", result.message));
    if (result.payload?.kind === "external-url") {
      print(line(span(`${result.payload.label}: ${result.payload.url}`, "info")));
    }
    return;
  }
  print(statusBanner("error", `UI action failed: ${result.reason}`, result.message));
  process.exitCode = 1;
}

export function buildUiCommand(ctx: ModuleContext): Command {
  const cmd = new Command("ui")
    .description("Render shared daemon UI surfaces and execute typed UI actions");

  cmd
    .command("render")
    .description("Render shared UI surfaces from the active KotaClient")
    .argument("[surface-id]", "Surface id to render; renders all surfaces when omitted")
    .option("--json", "Emit the shared UI surface bundle as JSON")
    .action(async (surfaceId: string | undefined, opts: { json?: boolean }) => {
      const bundle = await ctx.client.ui.listSurfaces();
      if (opts.json === true) {
        writeJson(
          surfaceId
            ? { ...bundle, surfaces: bundle.surfaces.filter((surface) => surface.surfaceId === surfaceId) }
            : bundle,
          { pretty: true },
        );
        return;
      }

      const surfaces = surfaceId
        ? bundle.surfaces.filter((surface) => surface.surfaceId === surfaceId)
        : bundle.surfaces;
      if (surfaces.length === 0) {
        print(statusBanner("error", "UI surface not found", surfaceId ?? "(empty bundle)"));
        process.exitCode = 1;
        return;
      }
      print(stack(...surfaces.flatMap((surface, index) => (
        index === 0
          ? [renderUiSurface(surface)]
          : [blank(), renderUiSurface(surface)]
      ))));
    });

  const action = new Command("action")
    .description("Execute shared UI actions by stable surface/action id");

  action
    .command("execute")
    .description("Execute a typed UI action from the shared surface bundle")
    .argument("<surface-id>", "Surface id that owns the action")
    .argument("<action-id>", "Stable action id to execute")
    .option("--params <json>", "JSON parameters for the action")
    .option("-y, --yes", "Allow execution of actions that declare required confirmation")
    .option("--json", "Emit the action execution result as JSON")
    .action(async (
      surfaceId: string,
      actionId: string,
      opts: { params?: string; yes?: boolean; json?: boolean },
    ) => {
      let parameters: UiJsonValue | undefined;
      try {
        parameters = parseParameters(opts.params);
      } catch (err) {
        print(statusBanner("error", "Invalid UI action parameters", err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
        return;
      }

      const bundle = await ctx.client.ui.listSurfaces();
      const selected = findUiAction(bundle, surfaceId, actionId);
      if (!selected) {
        const result: UiActionExecutionResult = {
          ok: false,
          reason: "not_found",
          message: `No UI action ${surfaceId}/${actionId} exists in the shared surface bundle.`,
        };
        if (opts.json === true) writeJson(result, { pretty: true });
        else printActionResult(result);
        process.exitCode = 1;
        return;
      }
      if (selected.confirmation.mode === "required" && opts.yes !== true) {
        const result: UiActionExecutionResult = {
          ok: false,
          reason: "confirmation_required",
          message: `${selected.label} requires confirmation; re-run with --yes to execute it from the CLI.`,
        };
        if (opts.json === true) writeJson(result, { pretty: true });
        else printActionResult(result);
        process.exitCode = 1;
        return;
      }

      const result = await ctx.client.ui.executeAction({ surfaceId, actionId, parameters });
      if (opts.json === true) {
        writeJson(result, { pretty: true });
        if (!result.ok) process.exitCode = 1;
        return;
      }
      printActionResult(result);
    });

  cmd.addCommand(action);
  cmd.addHelpText(
    "after",
    `\nExamples:\n  kota ui render runs\n  kota ui action execute runs workflow.status\n`,
  );
  cmd.addCommand(
    new Command("list")
      .description("List shared UI surface ids")
      .action(async () => {
        const bundle = await ctx.client.ui.listSurfaces();
        print(stack(...bundle.surfaces.map((surface) =>
          line(span(surface.surfaceId, "accent"), span(`  ${surface.title}`, "muted")),
        )));
      }),
  );

  return cmd;
}
