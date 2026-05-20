import type { Command } from "commander";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import { loadConfig } from "#core/config/config.js";
import { createModelClient } from "#core/model/model-client.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import { ensureCliProvidersFor } from "#core/modules/cli-providers.js";
import type {
  ConversationMessage,
  ConversationRecord,
} from "#core/modules/provider-types.js";
import { getActiveKotaClient } from "#core/server/client-holder.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { confirmAction } from "#core/util/confirm.js";
import type { ColumnsNode } from "#modules/rendering/primitives.js";
import {
  blank,
  columns,
  kvBlock,
  line,
  plain,
  span,
} from "#modules/rendering/primitives.js";
import { print, TerminalTransport } from "#modules/rendering/transport.js";
import { interactiveMode, parseIntOption, resolveConversationId } from "./cli.js";
import type {
  HistoryBoundedMessage,
  HistoryDetail,
  HistoryDetailView,
  HistoryShowOptions,
} from "./client.js";
import { renderHistorySearchPlain } from "./render.js";

let stderrRenderer: TerminalTransport | null = null;
function stderr(): TerminalTransport {
  if (!stderrRenderer) stderrRenderer = new TerminalTransport({ stream: process.stderr });
  return stderrRenderer;
}

/** Register the `history` subcommand and its children onto `program`. */
export function registerHistoryCommands(program: Command) {
  const historyCmd = program.command("history").description("Manage conversation history");

  historyCmd
    .command("list")
    .description("List recent conversations")
    .option("-n, --limit <n>", "Number of conversations to show", "10")
    .option("-s, --search <query>", "Filter by search term")
    .option("--all", "Show conversations from all directories")
    .action(async (opts) => {
      await ensureCliProvidersFor(["history"]);
      const client = getActiveKotaClient();
      const { conversations } = await client.history.list({
        limit: parseIntOption(opts.limit, "limit"),
        search: opts.search,
        cwd: opts.all ? undefined : process.cwd(),
      });

      if (conversations.length === 0) {
        print(line(plain("No conversations found.")));
        return;
      }

      print(buildHistoryListNode(conversations));
    });

  historyCmd
    .command("search <query>")
    .description("Search conversations (semantic by default)")
    .option("-n, --limit <n>", "Max conversations to show", "20")
    .option("--all", "Search across all directories")
    .option("--keyword", "Use keyword search instead of semantic ranking")
    .option("--no-semantic", "Alias for --keyword")
    .option(
      "--json",
      "Emit the structured { ok, conversations | reason } payload as JSON",
    )
    .action(async (query: string, opts: {
      limit: string;
      all?: boolean;
      keyword?: boolean;
      semantic?: boolean;
      json?: boolean;
    }) => {
      const trimmed = query.trim();
      if (!trimmed) {
        stderr().write(line(span("Usage: kota history search <query>", "warn")));
        process.exit(1);
      }

      await ensureCliProvidersFor(["history"]);
      const client = getActiveKotaClient();
      const limit = parseIntOption(opts.limit, "limit");
      const semantic = !(opts.keyword === true || opts.semantic === false);
      const result = await client.history.search(trimmed, {
        semantic,
        limit,
        cwd: opts.all ? undefined : process.cwd(),
      });

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return;
      }

      if (!result.ok) {
        stderr().write(line(span(
          "Semantic conversation search requires an embedding-backed history provider.",
          "error",
        )));
        process.exit(1);
      }

      if (result.conversations.length === 0) {
        print(line(plain("No matching conversations.")));
        return;
      }

      print(line(plain(renderHistorySearchPlain(result.conversations))));
    });

  historyCmd
    .command("show <id>")
    .description("Show conversation details")
    .option("--view <view>", "Detail view: metadata, window, full")
    .option("--offset <n>", "First message offset for view=window")
    .option("--limit <n>", "Number of messages for view=window")
    .option("--content-limit <n>", "Characters per message for view=window")
    .action(async (idOrPrefix, opts: {
      view?: string;
      offset?: string;
      limit?: string;
      contentLimit?: string;
    }) => {
      await ensureCliProvidersFor(["history"]);
      const client = getActiveKotaClient();
      const fullId = await resolveConversationId(client, idOrPrefix);
      const showOptions = buildShowOptions(opts);
      const result = await client.history.show(fullId, showOptions);
      if (!result.found) {
        stderr().write(line(span(`Conversation "${idOrPrefix}" not found.`, "error")));
        process.exit(1);
      }
      renderHistoryDetail(result.detail);
    });

  historyCmd
    .command("resume <id>")
    .description("Resume a previous conversation")
    .option("-m, --model <model>", "Model to use")
    .option("-v, --verbose", "Show debug output")
    .action(async (idOrPrefix, opts) => {
      await ensureCliProvidersFor(["history"]);
      const config = loadConfig();
      const client = getActiveKotaClient();
      const fullId = await resolveConversationId(client, idOrPrefix);
      const modelSpec =
        opts.model ||
        config.model ||
        resolveActivePresetFromConfig(config).defaultModel;
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
    .action(async (idOrPrefix) => {
      await ensureCliProvidersFor(["history"]);
      const client = getActiveKotaClient();
      const fullId = await resolveConversationId(client, idOrPrefix);
      const result = await client.history.delete(fullId);
      if (result.ok) {
        print(line(
          plain("Conversation "),
          span(fullId, "accent"),
          span(" deleted.", "success"),
        ));
      } else {
        stderr().write(line(span(`Conversation "${idOrPrefix}" not found.`, "error")));
        process.exit(1);
      }
    });

  historyCmd
    .command("reindex")
    .description(
      "Rebuild the semantic search index for all conversations. " +
        "No-op when no embedding provider is configured.",
    )
    .action(async () => {
      await ensureCliProvidersFor(["history"]);
      const client = getActiveKotaClient();
      const result = await client.history.reindex();
      if (result.skipped) {
        print(line(plain(
          "Semantic search not configured — nothing to reindex. " +
            "Set `providers.history` to an embedding-capable provider to enable.",
        )));
        return;
      }
      const failedRole = result.failed > 0 ? "error" : "muted";
      print(line(
        plain("Reindexed "),
        span(String(result.indexed), "success"),
        plain(" conversation(s) ("),
        span(`${result.failed} failed`, failedRole),
        plain(")."),
      ));
      if (result.failed > 0) process.exit(1);
    });

  historyCmd
    .command("clear")
    .description("Delete all conversations for the current directory")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts) => {
      await ensureCliProvidersFor(["history"]);
      const client: KotaClient = getActiveKotaClient();
      const { conversations } = await client.history.list({ cwd: process.cwd(), limit: 1000 });

      if (conversations.length === 0) {
        print(line(plain("No conversations to delete.")));
        return;
      }

      if (!opts.yes) {
        const confirmed = await confirmAction(
          `This will permanently delete ${conversations.length} conversation(s). Continue?`,
        );
        if (!confirmed) {
          print(line(span("Cancelled.", "muted")));
          return;
        }
      }

      let count = 0;
      for (const c of conversations) {
        const result = await client.history.delete(c.id);
        if (result.ok) count++;
      }
      print(line(span(`Deleted ${count} conversation(s).`, "success")));
    });
}

function buildShowOptions(opts: {
  view?: string;
  offset?: string;
  limit?: string;
  contentLimit?: string;
}): HistoryShowOptions {
  const view = parseDetailView(opts.view);
  const hasOffset = opts.offset !== undefined;
  const hasLimit = opts.limit !== undefined;
  const hasContentLimit = opts.contentLimit !== undefined;
  if (view !== "window" && (hasOffset || hasLimit || hasContentLimit)) {
    stderr().write(line(span(
      "--offset, --limit, and --content-limit are only valid with --view window",
      "error",
    )));
    process.exit(1);
  }
  if (view !== "window") return { view };
  return {
    view,
    ...(hasOffset && { offset: parseWindowOffset(opts.offset!) }),
    ...(hasLimit && { limit: parseWindowPositiveInteger(opts.limit!, "limit") }),
    ...(hasContentLimit && {
      contentLimit: parseWindowPositiveInteger(
        opts.contentLimit!,
        "content-limit",
      ),
    }),
  };
}

function parseDetailView(value: string | undefined): HistoryDetailView {
  if (value === undefined) return "window";
  if (value === "metadata" || value === "window" || value === "full") return value;
  stderr().write(line(span(
    `Error: --view must be one of metadata, window, full, got "${value}"`,
    "error",
  )));
  process.exit(1);
}

function parseWindowOffset(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0 || String(n) !== value) {
    stderr().write(
      line(span(`Error: --offset must be a non-negative integer, got "${value}"`, "error")),
    );
    process.exit(1);
  }
  return n;
}

function parseWindowPositiveInteger(value: string, name: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0 || String(n) !== value) {
    stderr().write(
      line(span(`Error: --${name} must be a positive integer, got "${value}"`, "error")),
    );
    process.exit(1);
  }
  return n;
}

function renderHistoryDetail(detail: HistoryDetail): void {
  print(kvBlock([
    { label: "Title", value: detail.record.title },
    { label: "Created", value: new Date(detail.record.createdAt).toLocaleString(), role: "muted" },
    { label: "Updated", value: new Date(detail.record.updatedAt).toLocaleString(), role: "muted" },
    { label: "Model", value: detail.record.model, role: "info" },
    { label: "Messages", value: String(detail.record.messageCount), role: "info" },
    { label: "View", value: detail.view, role: "info" },
    { label: "Window", value: formatMessageWindow(detail.messageWindow), role: "info" },
    { label: "Dir", value: detail.record.cwd, role: "muted" },
  ]));
  if (detail.view === "metadata") return;
  print(blank());
  if (detail.view === "full") {
    detail.messages.forEach((message, index) => renderFullMessage(message, index));
    return;
  }
  for (const message of detail.messages) {
    renderBoundedMessage(message);
  }
}

function formatMessageWindow(window: HistoryDetail["messageWindow"]): string {
  if (window.returned === 0) {
    return `${window.offset}-${window.offset} of ${window.total} (0 returned)`;
  }
  const last = window.offset + window.returned - 1;
  const before = window.hasMoreBefore ? " earlier" : "";
  const after = window.hasMoreAfter ? " later" : "";
  const more = before || after ? `; more:${before}${after}` : "";
  return `${window.offset}-${last} of ${window.total}${more}`;
}

function renderBoundedMessage(message: HistoryBoundedMessage): void {
  const role = message.role === "assistant" ? "agent" : "accent";
  const truncation = message.contentTruncation.truncated
    ? ` [truncated ${message.contentTruncation.maxCharacters}/${message.contentTruncation.originalCharacters}]`
    : "";
  print(line(
    span(`[${message.index} ${message.role}]`, role, true),
    plain(` ${messageContentText(message.content)}${truncation}`),
  ));
}

function renderFullMessage(
  message: ConversationMessage,
  index: number,
): void {
  const role = message.role === "assistant" ? "agent" : "accent";
  print(line(
    span(`[${index} ${message.role}]`, role, true),
    plain(` ${messageContentText(message.content)}`),
  ));
}

function messageContentText(content: ConversationMessage["content"]): string {
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text") parts.push(block.text);
    if (block.type === "thinking") parts.push(block.thinking);
    if (block.type === "tool_result") {
      if (typeof block.content === "string") parts.push(block.content);
      else {
        for (const nested of block.content) {
          if (nested.type === "text") parts.push(nested.text);
        }
      }
    }
  }
  return parts.join(" ");
}

export function buildHistoryListNode(conversations: ConversationRecord[]): ColumnsNode {
  return columns(
    [
      { header: "ID", role: "accent" },
      { header: "Updated" },
      { header: "Msgs", align: "right", role: "muted", minWidth: 4 },
      { header: "Title", maxWidth: 60 },
    ],
    conversations.map((c) => {
      const updated = new Date(c.updatedAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      return {
        cells: [
          { spans: [{ text: c.id, role: "accent" }] },
          { spans: [{ text: updated }] },
          { spans: [{ text: String(c.messageCount), role: "muted" }] },
          { spans: [{ text: c.title }] },
        ],
      };
    }),
  );
}
