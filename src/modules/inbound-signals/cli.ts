import { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  blank,
  columns,
  line,
  plain,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print, writeJson } from "#modules/rendering/transport.js";
import type {
  InboundSignalRouteListResult,
} from "./client.js";

function buildRouteRows(result: InboundSignalRouteListResult) {
  return result.routes.map((route) => ({
    cells: [
      { spans: [{ text: route.id, role: "accent" as const }] },
      { spans: [{ text: route.provider }] },
      { spans: [{ text: route.channel }] },
      { spans: [{ text: route.sourceId }] },
      { spans: [{ text: route.actorTrust }] },
      { spans: [{ text: route.sourceStatus }] },
      { spans: [{ text: route.scopeId }] },
      {
        spans: [
          {
            text: route.targets
              .map((target) => `${target.kind}:${target.name}`)
              .join(", "),
          },
        ],
      },
    ],
  }));
}

function printRouteList(result: InboundSignalRouteListResult): void {
  if (result.routes.length === 0) {
    print(line(plain("No inbound routes configured.")));
  } else {
    print(columns(
      [
        { header: "Route", role: "accent" },
        { header: "Provider" },
        { header: "Channel" },
        { header: "Source" },
        { header: "Trust" },
        { header: "Status" },
        { header: "Scope" },
        { header: "Targets", maxWidth: 60 },
      ],
      buildRouteRows(result),
    ));
  }

  if (result.validation.ok) {
    print(stack(
      blank(),
      line(span("Validation: ", "info"), span("ok", "success")),
    ));
    return;
  }

  print(stack(
    blank(),
    line(span("Validation: ", "info"), span("failed", "error")),
    ...result.validation.errors.map((error) =>
      line(
        plain("  "),
        span(error.routeId, "accent"),
        plain(": "),
        span(error.message, "error"),
      )
    ),
  ));
}

export function buildInboundSignalsCommand(ctx: ModuleContext): Command {
  const cmd = new Command("inbound-signals")
    .alias("inbound")
    .description("Inspect inbound signal routes and source statuses");

  cmd
    .command("routes")
    .description("List configured inbound signal routes and validation status")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      const result = await ctx.client.inboundSignals.listRoutes();
      if (opts.json) {
        writeJson(result, { pretty: true });
        return;
      }
      printRouteList(result);
    });

  return cmd;
}
