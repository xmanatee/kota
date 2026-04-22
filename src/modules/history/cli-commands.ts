import type { Command } from "commander";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import { loadConfig } from "#core/config/config.js";
import { createModelClient } from "#core/model/model-client.js";
import { confirmAction } from "#core/util/confirm.js";
import {
  blank,
  kvBlock,
  type LineNode,
  line,
  plain,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { interactiveMode, parseIntOption, resolveConversationId } from "./cli.js";
import { getHistory } from "./history.js";

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
        print(line(plain("No conversations found.")));
        return;
      }

      const header: LineNode = line(span(
        `${"ID".padEnd(17)} ${"Updated".padEnd(22)} ${"Msgs".padEnd(6)} Title`,
        "muted",
        true,
      ));
      const rule: LineNode = line(span("-".repeat(80), "muted"));
      const rows: LineNode[] = list.map((c) => {
        const updated = new Date(c.updatedAt).toLocaleString("en-US", {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
        });
        return line(
          span(c.id.padEnd(17), "accent"),
          plain(` ${updated.padEnd(22)} `),
          span(String(c.messageCount).padEnd(6), "muted"),
          plain(` ${c.title}`),
        );
      });
      print(stack(header, rule, ...rows));
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

      print(kvBlock([
        { label: "Title", value: data.record.title },
        { label: "Created", value: new Date(data.record.createdAt).toLocaleString(), role: "muted" },
        { label: "Updated", value: new Date(data.record.updatedAt).toLocaleString(), role: "muted" },
        { label: "Model", value: data.record.model, role: "info" },
        { label: "Messages", value: String(data.record.messageCount), role: "info" },
        { label: "Dir", value: data.record.cwd, role: "muted" },
      ]));
      print(blank());

      for (const msg of data.messages) {
        if (msg.role === "user" && typeof msg.content === "string") {
          print(line(span("[user]", "accent", true), plain(` ${msg.content.slice(0, 200)}`)));
        } else if (msg.role === "assistant" && typeof msg.content === "string") {
          print(line(span("[assistant]", "agent", true), plain(` ${msg.content.slice(0, 200)}`)));
        } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
          const textBlock = msg.content.find((b) => "type" in b && b.type === "text");
          if (textBlock && "text" in textBlock) {
            print(line(
              span("[assistant]", "agent", true),
              plain(` ${String(textBlock.text).slice(0, 200)}`),
            ));
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
        autonomyMode: resolveChannelAutonomyMode(
          config.cli?.defaultAutonomyMode,
          config,
          "history resume",
        ),
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
        print(line(
          plain("Conversation "),
          span(fullId, "accent"),
          span(" deleted.", "success"),
        ));
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
        print(line(plain("No conversations to delete.")));
        return;
      }

      if (!opts.yes) {
        const confirmed = await confirmAction(
          `This will permanently delete ${list.length} conversation(s). Continue?`,
        );
        if (!confirmed) {
          print(line(span("Cancelled.", "muted")));
          return;
        }
      }

      let count = 0;
      for (const c of list) {
        if (history.remove(c.id)) count++;
      }
      print(line(span(`Deleted ${count} conversation(s).`, "success")));
    });
}
