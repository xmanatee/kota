import type { Command } from "commander";
import { interactiveMode, parseIntOption, resolveConversationId } from "./cli-history.js";
import { loadConfig } from "./config.js";
import { confirmAction } from "./confirm.js";
import { createModelClient } from "./core/model/model-client.js";
import { getHistory } from "./core/memory/history.js";

/** Register the `history` subcommand and its children onto `program`. */
export function registerHistoryCommands(program: Command) {
  const historyCmd = program.command("history").description("Manage conversation history");

  historyCmd
    .command("list")
    .description("List recent conversations")
    .option("-n, --limit <n>", "Number of conversations to show", "10")
    .option("-s, --search <query>", "Filter by search term")
    .option("--all", "Show conversations from all directories")
    .action((opts) => {
      const history = getHistory();
      const list = history.list({
        limit: parseIntOption(opts.limit, "limit"),
        search: opts.search,
        cwd: opts.all ? undefined : process.cwd(),
      });

      if (list.length === 0) {
        console.log("No conversations found.");
        return;
      }

      console.log(`${"ID".padEnd(17)} ${"Updated".padEnd(22)} ${"Msgs".padEnd(6)} Title`);
      console.log("-".repeat(80));
      for (const c of list) {
        const updated = new Date(c.updatedAt).toLocaleString("en-US", {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
        });
        console.log(`${c.id.padEnd(17)} ${updated.padEnd(22)} ${String(c.messageCount).padEnd(6)} ${c.title}`);
      }
    });

  historyCmd
    .command("show <id>")
    .description("Show conversation details")
    .action((idOrPrefix) => {
      const history = getHistory();
      const fullId = resolveConversationId(history, idOrPrefix);
      const data = history.load(fullId);
      if (!data) {
        console.error(`Conversation "${idOrPrefix}" not found.`);
        process.exit(1);
      }

      console.log(`Title:    ${data.record.title}`);
      console.log(`Created:  ${new Date(data.record.createdAt).toLocaleString()}`);
      console.log(`Updated:  ${new Date(data.record.updatedAt).toLocaleString()}`);
      console.log(`Model:    ${data.record.model}`);
      console.log(`Messages: ${data.record.messageCount}`);
      console.log(`Dir:      ${data.record.cwd}`);
      console.log();

      for (const msg of data.messages) {
        if (msg.role === "user" && typeof msg.content === "string") {
          console.log(`[user] ${msg.content.slice(0, 200)}`);
        } else if (msg.role === "assistant" && typeof msg.content === "string") {
          console.log(`[assistant] ${msg.content.slice(0, 200)}`);
        } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
          const textBlock = msg.content.find((b) => "type" in b && b.type === "text");
          if (textBlock && "text" in textBlock) {
            console.log(`[assistant] ${String(textBlock.text).slice(0, 200)}`);
          }
        }
      }
    });

  historyCmd
    .command("resume <id>")
    .description("Resume a previous conversation")
    .option("-m, --model <model>", "Model to use")
    .option("-v, --verbose", "Show debug output")
    .action(async (idOrPrefix, opts) => {
      const config = loadConfig();
      const history = getHistory();
      const fullId = resolveConversationId(history, idOrPrefix);
      const modelSpec = opts.model || config.model || "claude-sonnet-4-6";
      const resolved = createModelClient({
        model: modelSpec,
        provider: config.modelProvider?.type,
        baseUrl: config.modelProvider?.baseUrl,
        apiKey: config.modelProvider?.apiKey,
      });
      await interactiveMode({
        model: resolved.model,
        verbose: opts.verbose || config.verbose,
        config,
        resumeConversation: fullId,
        client: resolved.client,
      }, config);
    });

  historyCmd
    .command("delete <id>")
    .description("Delete a conversation")
    .action((idOrPrefix) => {
      const history = getHistory();
      const fullId = resolveConversationId(history, idOrPrefix);
      if (history.remove(fullId)) {
        console.log(`Conversation ${fullId} deleted.`);
      } else {
        console.error(`Conversation "${idOrPrefix}" not found.`);
        process.exit(1);
      }
    });

  historyCmd
    .command("clear")
    .description("Delete all conversations for the current directory")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts) => {
      const history = getHistory();
      const list = history.list({ cwd: process.cwd(), limit: 1000 });

      if (list.length === 0) {
        console.log("No conversations to delete.");
        return;
      }

      if (!opts.yes) {
        const confirmed = await confirmAction(
          `This will permanently delete ${list.length} conversation(s). Continue?`,
        );
        if (!confirmed) {
          console.log("Cancelled.");
          return;
        }
      }

      let count = 0;
      for (const c of list) {
        if (history.remove(c.id)) count++;
      }
      console.log(`Deleted ${count} conversation(s).`);
    });
}
