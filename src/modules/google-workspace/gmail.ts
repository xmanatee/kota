import type { ToolDef } from "#core/modules/module-types.js";
import { legacyEffect } from "#core/tools/effect.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { apiError, googleFetch } from "./auth.js";

export function makeGmailListMessages(
  getToken: () => Promise<string>,
  userId: string,
): ToolDef {
  return {
    effect: legacyEffect({ risk: "safe", kind: "discovery", openWorld: true }),
    group: "productivity",
    tool: {
      name: "gmail_list_messages",
      description:
        "List recent Gmail messages. Returns message IDs, subjects, senders, and snippets. " +
        "Optionally filter with a Gmail search query (e.g. 'is:unread', 'from:alice@example.com').",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Gmail search query (optional)" },
          maxResults: {
            type: "number",
            description: "Maximum number of messages to return (default: 10, max: 50)",
          },
        },
        required: [],
      },
    },
    async runner(input): Promise<ToolResult> {
      const token = await getToken();
      const max = Math.min((input.maxResults as number | undefined) ?? 10, 50);
      const params = new URLSearchParams({ maxResults: String(max) });
      if (input.query) params.set("q", input.query as string);

      const listRes = await googleFetch(
        token,
        "GET",
        `https://gmail.googleapis.com/gmail/v1/users/${userId}/messages?${params}`,
      );
      if (!listRes.ok) return apiError("list messages", listRes.status, listRes.data);

      const list = listRes.data as { messages?: Array<{ id: string }>; resultSizeEstimate?: number };
      const messages = list.messages ?? [];
      if (messages.length === 0) return { content: "No messages found." };

      const metaResults = await Promise.all(
        messages.slice(0, max).map(async (m) => {
          const r = await googleFetch(
            token,
            "GET",
            `https://gmail.googleapis.com/gmail/v1/users/${userId}/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          );
          if (!r.ok) return null;
          return r.data as {
            id: string;
            snippet: string;
            labelIds?: string[];
            payload?: { headers?: Array<{ name: string; value: string }> };
          };
        }),
      );

      const lines = metaResults
        .filter(Boolean)
        .map((msg) => {
          if (!msg) return "";
          const headers = msg.payload?.headers ?? [];
          const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
          const from = headers.find((h) => h.name === "From")?.value ?? "";
          const date = headers.find((h) => h.name === "Date")?.value ?? "";
          const unread = msg.labelIds?.includes("UNREAD") ? " [unread]" : "";
          return `[${msg.id}]${unread} ${subject}\n  From: ${from} | ${date}\n  ${msg.snippet}`;
        })
        .filter(Boolean);

      return { content: `${lines.length} message(s):\n\n${lines.join("\n\n")}` };
    },
  };
}

export function makeGmailGetMessage(
  getToken: () => Promise<string>,
  userId: string,
): ToolDef {
  return {
    effect: legacyEffect({ risk: "safe", kind: "discovery", openWorld: true }),
    group: "productivity",
    tool: {
      name: "gmail_get_message",
      description: "Get the full content of a Gmail message by its ID.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Gmail message ID" },
        },
        required: ["id"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const token = await getToken();
      const res = await googleFetch(
        token,
        "GET",
        `https://gmail.googleapis.com/gmail/v1/users/${userId}/messages/${input.id as string}?format=full`,
      );
      if (!res.ok) return apiError("get message", res.status, res.data);

      const msg = res.data as {
        id: string;
        snippet: string;
        labelIds?: string[];
        payload?: {
          headers?: Array<{ name: string; value: string }>;
          body?: { data?: string };
          parts?: Array<{ mimeType: string; body?: { data?: string } }>;
        };
      };

      const headers = msg.payload?.headers ?? [];
      const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
      const from = headers.find((h) => h.name === "From")?.value ?? "";
      const to = headers.find((h) => h.name === "To")?.value ?? "";
      const date = headers.find((h) => h.name === "Date")?.value ?? "";

      let body = "";
      const parts = msg.payload?.parts ?? [];
      const plainPart = parts.find((p) => p.mimeType === "text/plain");
      const rawData = plainPart?.body?.data ?? msg.payload?.body?.data;
      if (rawData) {
        body = Buffer.from(rawData, "base64url").toString("utf-8");
      } else {
        body = msg.snippet;
      }

      return {
        content: [`Subject: ${subject}`, `From: ${from}`, `To: ${to}`, `Date: ${date}`, "", body].join(
          "\n",
        ),
      };
    },
  };
}

export function makeGmailSend(getToken: () => Promise<string>, userId: string): ToolDef {
  return {
    effect: legacyEffect({ risk: "dangerous", kind: "action", openWorld: true }),
    group: "productivity",
    tool: {
      name: "gmail_send",
      description: "Send a Gmail message. Requires operator approval in autonomous mode.",
      input_schema: {
        type: "object" as const,
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body (plain text)" },
          cc: { type: "string", description: "CC email address (optional)" },
        },
        required: ["to", "subject", "body"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const token = await getToken();

      const lines = [
        `To: ${input.to as string}`,
        `Subject: ${input.subject as string}`,
        "Content-Type: text/plain; charset=utf-8",
        "MIME-Version: 1.0",
      ];
      if (input.cc) lines.push(`Cc: ${input.cc as string}`);
      lines.push("", input.body as string);

      const raw = Buffer.from(lines.join("\r\n")).toString("base64url");

      const res = await googleFetch(
        token,
        "POST",
        `https://gmail.googleapis.com/gmail/v1/users/${userId}/messages/send`,
        { raw },
      );
      if (!res.ok) return apiError("send message", res.status, res.data);

      const sent = res.data as { id: string; threadId: string };
      return { content: `Message sent. ID: ${sent.id}, Thread: ${sent.threadId}` };
    },
  };
}
