import { randomBytes } from "node:crypto";
import type { Command } from "commander";
import { loadConfig, updateProjectConfig } from "./config.js";
import { loadModuleMetadata } from "./module-metadata.js";

export function registerWebhookCommands(program: Command): void {
  const webhookCmd = program
    .command("webhook")
    .description("Manage inbound webhook secrets for workflow triggers");

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
        console.log("No workflows with webhook triggers found.");
        return;
      }

      const nameWidth = Math.max(...webhookDefs.map((d) => d.name.length), 8);
      console.log(`${"Workflow".padEnd(nameWidth)}  Secret`);
      console.log("-".repeat(nameWidth + 10));
      for (const def of webhookDefs) {
        const hasSecret = !!config.webhooks?.[def.name]?.secret;
        console.log(`${def.name.padEnd(nameWidth)}  ${hasSecret ? "✓ configured" : "✗ not configured"}`);
      }
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

      console.log(`Secret for "${workflow}" (save this — it will not be shown again):`);
      console.log(secret);
      console.log();
      console.log("Sign each request with HMAC-SHA256 and send the signature in X-Kota-Webhook-Signature:");
      console.log();
      console.log("  // Node.js");
      console.log(`  const sig = "sha256=" + require("crypto").createHmac("sha256", secret).update(rawBody).digest("hex");`);
      console.log(`  // Set header: X-Kota-Webhook-Signature: <sig>`);
      console.log();
      console.log("  // Optional replay protection: set X-Kota-Webhook-Timestamp to the current Unix ms timestamp");
      console.log(`  //   X-Kota-Webhook-Timestamp: ${Date.now()} (requests older than 5 minutes are rejected)`);
    });

  secretCmd
    .command("remove <workflow>")
    .description("Remove the webhook secret for a workflow from .kota/config.json")
    .action((workflow: string) => {
      const config = loadConfig();
      if (!config.webhooks?.[workflow]) {
        console.log(`No webhook secret configured for "${workflow}".`);
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

      console.log(`Removed webhook secret for "${workflow}".`);
    });
}
