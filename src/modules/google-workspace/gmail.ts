import { z } from "zod";
import type { ToolDef } from "#core/modules/module-types.js";
import { type OutboundHttpRequestPort, outboundHttp } from "#core/outbound-http/index.js";
import { networkDestructiveEffect, networkReadEffect } from "#core/tools/effect.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { apiError, googleFetch } from "./auth.js";
import { gmailMessageResult } from "./gmail-message.js";
import { listGooglePages, listingStatus, MAX_LIST_PAGES } from "./listing.js";

const messagePageSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).optional(),
  resultSizeEstimate: z.number().int().nonnegative().optional(),
  nextPageToken: z.string().min(1).optional(),
}).refine((page) => Object.values(page).some((value) => value !== undefined))
  .transform((page) => ({ items: page.messages ?? [], nextPageToken: page.nextPageToken }));

const messageMetadataSchema = z.object({
  id: z.string().min(1),
  snippet: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  payload: z.object({
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  }).optional(),
});

export function makeGmailListMessages(
  getToken: () => Promise<string>,
  userId: string,
  http: OutboundHttpRequestPort = outboundHttp,
): ToolDef {
  return {
    effect: networkReadEffect(),
    group: "productivity",
    tool: {
      name: "gmail_list_messages",
      description:
        "List recent Gmail messages. Returns message IDs, subjects, senders, and snippets. " +
        `Optionally filter with a Gmail search query (e.g. 'is:unread', 'from:alice@example.com'). Follows up to ${MAX_LIST_PAGES} pages within maxResults and discloses incomplete lists and unavailable message details.`,
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Gmail search query (optional)" },
          maxResults: {
            type: "integer",
            minimum: 1,
            description: "Maximum number of messages to return (default: 10, max: 50)",
          },
        },
        required: [],
      },
    },
    async runner(input): Promise<ToolResult> {
      const requestedMax = input.maxResults ?? 10;
      if (typeof requestedMax !== "number" || !Number.isInteger(requestedMax) || requestedMax < 1) {
        return { content: "maxResults must be a positive integer.", is_error: true };
      }
      const max = Math.min(requestedMax, 50);
      const params = new URLSearchParams({ maxResults: String(max) });
      if (input.query) params.set("q", input.query as string);
      const baseUrl = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userId)}/messages`;
      let tokenPromise: Promise<string> | undefined;
      const listingToken = () => tokenPromise ??= getToken();
      const { items: messages, state } = await listGooglePages({
        getToken: listingToken,
        http,
        maxResults: max,
        pageSchema: messagePageSchema,
        url: (remaining, pageToken) => {
          params.set("maxResults", String(remaining));
          if (pageToken) params.set("pageToken", pageToken);
          return `${baseUrl}?${params}`;
        },
      });

      const details = await Promise.all(messages.map(async (message) => {
        const unavailable = (reason: string) => ({
          available: false,
          line: `[${message.id}] Details unavailable: ${reason}`,
        });
        try {
          const response = await googleFetch(
            await listingToken(), "GET",
            `${baseUrl}/${encodeURIComponent(message.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            undefined, http,
          );
          if (!response.ok) return unavailable(`Google API error (${response.status}).`);
          const parsed = messageMetadataSchema.safeParse(response.data);
          if (!parsed.success || parsed.data.id !== message.id) {
            return unavailable("Google returned invalid message metadata.");
          }
          const msg = parsed.data;
          const headers = msg.payload?.headers ?? [];
          const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "(no subject)";
          const from = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
          const date = headers.find((h) => h.name.toLowerCase() === "date")?.value ?? "";
          const unread = msg.labelIds?.includes("UNREAD") ? " [unread]" : "";
          return {
            available: true,
            line: `[${msg.id}]${unread} ${subject}\n  From: ${from} | ${date}\n  ${msg.snippet ?? "(snippet unavailable)"}`,
          };
        } catch {
          return unavailable("Google request failed.");
        }
      }));
      const failed = details.filter((detail) => !detail.available).length;
      return {
        content: [
          listingStatus(state, "Complete message list for the requested query."),
          ...(failed ? [`Message details incomplete: ${failed} of ${messages.length} unavailable. Listed IDs are retained below.`] : []),
          state.kind === "complete" && messages.length === 0
            ? "No messages found."
            : `${messages.length} message(s) listed; ${messages.length - failed} details retrieved:\n\n${details.map((detail) => detail.line).join("\n\n")}`,
        ].join("\n"),
        ...(state.kind === "unavailable" || failed > 0 ? { is_error: true } : {}),
      };
    },
  };
}

export function makeGmailGetMessage(
  getToken: () => Promise<string>,
  userId: string,
  http: OutboundHttpRequestPort = outboundHttp,
): ToolDef {
  return {
    effect: networkReadEffect(),
    group: "productivity",
    tool: {
      name: "gmail_get_message",
      description: "Read available inline plain-text content of a Gmail message, including nested mixed and alternative parts. Excludes attachments and labels unavailable, partial, or snippet-only content; separately stored bodies and other MIME formats are not fetched or rendered.",
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
        undefined,
        http,
      );
      if (!res.ok) return apiError("get message", res.status, res.data);

      return gmailMessageResult(res.data);
    },
  };
}

export function makeGmailSend(
  getToken: () => Promise<string>,
  userId: string,
  http: OutboundHttpRequestPort = outboundHttp,
): ToolDef {
  return {
    effect: networkDestructiveEffect(),
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
        http,
      );
      if (!res.ok) return apiError("send message", res.status, res.data);

      const sent = res.data as { id: string; threadId: string };
      return { content: `Message sent. ID: ${sent.id}, Thread: ${sent.threadId}` };
    },
  };
}
