import { randomBytes } from "node:crypto";
import type { Command } from "commander";
import { loadConfig, updateProjectConfig } from "#core/config/config.js";
import { loadModuleMetadata } from "#core/modules/module-metadata.js";
import {
  blank,
  type LineNode,
  line,
  plain,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";

export function registerWebhookCommands(webhookCmd: Command): void {
  webhookCmd
    .command("list")
    .description(
      "List workflows with webhook triggers and whether a secret is configured",
    )
    .action(async () => {
      const config = loadConfig();
      const loader = await loadModuleMetadata(config, process.cwd(), false);
      const definitions = loader.getContributedWorkflows();
      const webhookDefs = definitions.filter((d) =>
        d.triggers.some((t) => t.webhook),
      );

      if (webhookDefs.length === 0) {
        print(line(plain("No workflows with webhook triggers found.")));
        return;
      }

      const nameWidth = Math.max(...webhookDefs.map((d) => d.name.length), 8);
      const header = line(span(
        `${"Workflow".padEnd(nameWidth)}  Secret`,
        "muted",
        true,
      ));
      const rule = line(span("-".repeat(nameWidth + 10), "muted"));
      const rows: LineNode[] = webhookDefs.map((def) => {
        const hasSecret = !!config.webhooks?.[def.name]?.secret;
        return hasSecret
          ? line(plain(`${def.name.padEnd(nameWidth)}  `), span("✓ configured", "success"))
          : line(plain(`${def.name.padEnd(nameWidth)}  `), span("✗ not configured", "warn"));
      });
      print(stack(header, rule, ...rows));
    });

  const secretCmd = webhookCmd
    .command("secret")
    .description("Manage webhook secrets");

  secretCmd
    .command("generate <workflow>")
    .description(
      "Generate a cryptographically random secret for a workflow and save it to .kota/config.json",
    )
    .action((workflow: string) => {
      const config = loadConfig();
      const existing = config.webhooks?.[workflow]?.secret;
      if (existing) {
        console.warn(
          `Warning: a secret already exists for "${workflow}". It will be overwritten.`,
        );
      }

      const secret = randomBytes(32).toString("hex");

      updateProjectConfig(process.cwd(), (raw) => ({
        ...raw,
        webhooks: {
          ...(raw.webhooks ?? {}),
          [workflow]: { secret },
        },
      }));

      print(stack(
        line(
          plain("Secret for "),
          span(`"${workflow}"`, "accent"),
          plain(" (save this — it will not be shown again):"),
        ),
        line(span(secret, "success", true)),
        blank(),
        line(span(
          "Sign each request with HMAC-SHA256 and send the signature in X-Kota-Webhook-Signature:",
          "muted",
        )),
        blank(),
        line(span("  // Node.js", "muted")),
        line(plain(
          `  const sig = "sha256=" + require("crypto").createHmac("sha256", secret).update(rawBody).digest("hex");`,
        )),
        line(span(`  // Set header: X-Kota-Webhook-Signature: <sig>`, "muted")),
        blank(),
        line(span(
          "  // Optional replay protection: set X-Kota-Webhook-Timestamp to the current Unix ms timestamp",
          "muted",
        )),
        line(span(
          `  //   X-Kota-Webhook-Timestamp: ${Date.now()} (requests older than 5 minutes are rejected)`,
          "muted",
        )),
      ));
    });

  secretCmd
    .command("remove <workflow>")
    .description(
      "Remove the webhook secret for a workflow from .kota/config.json",
    )
    .action((workflow: string) => {
      const config = loadConfig();
      if (!config.webhooks?.[workflow]) {
        print(line(
          plain("No webhook secret configured for "),
          span(`"${workflow}"`, "accent"),
          plain("."),
        ));
        return;
      }

      updateProjectConfig(process.cwd(), (raw) => {
        const webhooks = { ...(raw.webhooks ?? {}) };
        delete webhooks[workflow];
        if (Object.keys(webhooks).length === 0) {
          const { webhooks: _removed, ...rest } = raw;
          return rest;
        }
        return { ...raw, webhooks };
      });

      print(line(
        plain("Removed webhook secret for "),
        span(`"${workflow}"`, "accent"),
        span(".", "success"),
      ));
    });
}
