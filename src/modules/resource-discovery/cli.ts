import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { line, plain, span } from "#modules/rendering/primitives.js";
import {
  print,
  printToStderr,
  writeJson,
} from "#modules/rendering/transport.js";
import {
  RESOURCE_DISCOVERY_KINDS,
  type ResourceDiscoveryKind,
  type ResourceDiscoveryProvider,
  type ResourceDiscoveryResult,
} from "./client.js";
import { renderResourceDiscoveryResultPlain } from "./render.js";

function collectKind(
  value: string,
  previous: ResourceDiscoveryKind[],
): ResourceDiscoveryKind[] {
  if (!RESOURCE_DISCOVERY_KINDS.includes(value as ResourceDiscoveryKind)) {
    printToStderr(line(span(
      `Unknown resource kind "${value}". Valid: ${RESOURCE_DISCOVERY_KINDS.join(", ")}`,
      "error",
    )));
    process.exit(1);
  }
  return [...previous, value as ResourceDiscoveryKind];
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    printToStderr(line(span(`Error: ${label} must be a positive integer.`, "error")));
    process.exit(1);
  }
  return parsed;
}

function parseScore(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    printToStderr(line(span("Error: --min-score must be a non-negative number.", "error")));
    process.exit(1);
  }
  return parsed;
}

export function registerResourceDiscoveryCommand(
  program: Command,
  ctx: ModuleContext,
  fallbackProvider?: ResourceDiscoveryProvider,
): void {
  program
    .command("resource-discovery <query>")
    .description("Rank KOTA capabilities for a natural-language task")
    .option("-n, --limit <n>", "Max resources to return (default 20)", "20")
    .option(
      "-k, --kind <kind>",
      `Restrict to a resource kind. Repeatable. Valid: ${RESOURCE_DISCOVERY_KINDS.join(", ")}`,
      collectKind,
      [] as ResourceDiscoveryKind[],
    )
    .option("--min-score <n>", "Drop resources below a keyword score")
    .option("--hide-unavailable", "Omit unavailable resources")
    .option("--json", "Emit the structured discovery envelope as JSON")
    .action(async (
      query: string,
      opts: {
        limit: string;
        kind: ResourceDiscoveryKind[];
        minScore?: string;
        hideUnavailable?: boolean;
        json?: boolean;
      },
    ) => {
      const filter = {
        limit: parsePositiveInteger(opts.limit, "--limit"),
        ...(opts.kind.length > 0 ? { kinds: opts.kind } : {}),
        ...(opts.minScore !== undefined ? { minScore: parseScore(opts.minScore) } : {}),
        ...(opts.hideUnavailable === true ? { includeUnavailable: false } : {}),
      };
      let result: ResourceDiscoveryResult;
      try {
        result = await ctx.client.resourceDiscovery.discover(query, filter);
      } catch (err) {
        if (
          !fallbackProvider ||
          !(err instanceof Error) ||
          !canUseLocalFallbackMessage(err.message)
        ) {
          throw err;
        }
        result = await fallbackProvider.discover(query, filter);
      }
      if (opts.json) {
        writeJson(result, { pretty: true });
        if (!result.ok) process.exit(1);
        return;
      }
      print(line(plain(renderResourceDiscoveryResultPlain(result))));
      if (!result.ok) process.exit(1);
    });
}

function canUseLocalFallbackMessage(message: string): boolean {
  return (
    message === "Not found" ||
    message.includes("Resource discovery provider is not initialized")
  );
}
