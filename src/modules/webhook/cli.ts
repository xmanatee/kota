import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  blank,
  type LineNode,
  line,
  plain,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";

export function registerWebhookCommands(webhookCmd: Command, ctx: ModuleContext): void {
  webhookCmd
    .command("list")
    .description(
      "List workflows with webhook triggers and whether a secret is configured",
    )
    .action(async () => {
      const result = await ctx.client.webhook.list();
      if (result.entries.length === 0) {
        print(line(plain("No workflows with webhook triggers found.")));
        return;
      }

      const nameWidth = Math.max(
        ...result.entries.map((entry) => entry.workflow.length),
        8,
      );
      const header = line(span(
        `${"Workflow".padEnd(nameWidth)}  Secret`,
        "muted",
        true,
      ));
      const rule = line(span("-".repeat(nameWidth + 10), "muted"));
      const rows: LineNode[] = result.entries.map((entry) =>
        entry.hasSecret
          ? line(plain(`${entry.workflow.padEnd(nameWidth)}  `), span("✓ configured", "success"))
          : line(plain(`${entry.workflow.padEnd(nameWidth)}  `), span("✗ not configured", "warn")),
      );
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
    .action(async (workflow: string) => {
      const result = await ctx.client.webhook.secretGenerate(workflow);
      if (result.overwrote) {
        console.warn(
          `Warning: a secret already existed for "${workflow}". It has been overwritten.`,
        );
      }

      print(stack(
        line(
          plain("Secret for "),
          span(`"${result.workflow}"`, "accent"),
          plain(" (save this — it will not be shown again):"),
        ),
        line(span(result.secret, "success", true)),
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
    .action(async (workflow: string) => {
      const result = await ctx.client.webhook.secretRemove(workflow);
      if (!result.removed) {
        print(line(
          plain("No webhook secret configured for "),
          span(`"${result.workflow}"`, "accent"),
          plain("."),
        ));
        return;
      }

      print(line(
        plain("Removed webhook secret for "),
        span(`"${result.workflow}"`, "accent"),
        span(".", "success"),
      ));
    });
}
