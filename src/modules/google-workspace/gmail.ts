import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { z } from "zod";
import type { ToolDef } from "#core/modules/module-types.js";
import { type OutboundHttpRequestPort, outboundHttp } from "#core/outbound-http/index.js";
import { networkDestructiveEffect, networkReadEffect } from "#core/tools/effect.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { apiError, googleFetch } from "./auth.js";
import { gmailMessageResult } from "./gmail-message.js";
import { decodeGmailReplyParent, type GmailReplyParent, gmailHeaderValue, gmailResourceId } from "./gmail-reply.js";
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
      const id = gmailResourceId.safeParse(input.id);
      if (!id.success) return { content: "Invalid Gmail message ID.", is_error: true };
      const token = await getToken();
      const res = await googleFetch(
        token,
        "GET",
        `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(id.data)}?format=full`,
        undefined,
        http,
      );
      if (!res.ok) return apiError("get message", res.status, res.data);

      const identity = z.object({ id: gmailResourceId }).safeParse(res.data);
      if (identity.success && identity.data.id !== id.data) {
        return { content: "Google returned a different message than requested.", is_error: true };
      }
      const result = gmailMessageResult(res.data);
      const parent = decodeGmailReplyParent(res.data);
      return { ...result, content: `${result.content}\n\n${parent
        ? `Reply selection: ${JSON.stringify({ replyToMessageId: parent.id, replyThreadId: parent.threadId, subject: parent.subject })}\nChoose recipients explicitly from the message; no automatic reply-all.`
        : "Reply unavailable: missing or unusable parent identity, subject, or RFC headers."}` };
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
      description: "Send a new Gmail message or reply to a selected message. For replies, first use gmail_get_message, then copy replyToMessageId, replyThreadId and the exact subject from its Reply selection. Supply only intended to/cc recipients; recipients are never inferred or expanded. Requires operator approval in autonomous mode. An uncertain send must be checked in Gmail before retrying.",
      input_schema: {
        type: "object" as const,
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body (plain text)" },
          cc: { type: "string", description: "CC email address (optional)" },
          replyToMessageId: { type: "string", description: "Selected parent Gmail message ID from gmail_get_message; requires replyThreadId" },
          replyThreadId: { type: "string", description: "Selected conversation ID from gmail_get_message; requires replyToMessageId" },
        },
        required: ["to", "subject", "body"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const parsed = sendInputSchema.safeParse(input);
      if (!parsed.success) return { content: "Invalid send input: supply to, subject and body, single-line headers, and both reply IDs together when replying.", is_error: true };
      const message = parsed.data;
      const baseUrl = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userId)}/messages`;
      let token: string;
      let parent: GmailReplyParent | null = null;
      try {
        token = await getToken();
        if (message.replyToMessageId !== undefined) {
          const res = await googleFetch(token, "GET",
            `${baseUrl}/${encodeURIComponent(message.replyToMessageId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=In-Reply-To`, undefined, http);
          if (!res.ok) return { content: `Reply not sent: parent metadata unavailable (Google API ${res.status}).`, is_error: true };
          parent = decodeGmailReplyParent(res.data);
          if (!parent || parent.id !== message.replyToMessageId || parent.threadId !== message.replyThreadId || parent.subject !== message.subject) {
            return { content: "Reply not sent: parent metadata is missing, unusable, or does not match the approved message, thread and subject. Read the selected message again.", is_error: true };
          }
        }
      } catch {
        return { content: "Message not sent: credentials or parent metadata could not be retrieved.", is_error: true };
      }
      const bytes = await new MailComposer({
        to: message.to, cc: message.cc, subject: message.subject, text: message.body,
        ...(parent ? { inReplyTo: parent.messageId, references: parent.references } : {}),
      }).compile().build();
      try {
        const res = await googleFetch(token, "POST", `${baseUrl}/send`, {
          raw: bytes.toString("base64url"), ...(parent ? { threadId: parent.threadId } : {}),
        }, http);
        if (!res.ok) return { content: `Send not confirmed (Google API ${res.status}). Check Gmail before retrying.`, is_error: true };
        const sent = sentMessageSchema.safeParse(res.data);
        if (!sent.success || (parent && (sent.data.threadId !== parent.threadId || sent.data.id === parent.id))) {
          return { content: "Send outcome uncertain: Google returned missing or inconsistent message/thread identity. A message may have been sent; check Gmail before retrying. Reply in the selected conversation is not confirmed.", is_error: true };
        }
        return { content: parent
          ? `Google accepted reply to message ${parent.id} in thread ${parent.threadId}. Sent message ID: ${sent.data.id}. Recipient delivery is not verified.`
          : `Message sent. ID: ${sent.data.id}, Thread: ${sent.data.threadId}` };
      } catch {
        return { content: "Send outcome uncertain: Google request failed. A message may have been sent; check Gmail before retrying.", is_error: true };
      }
    },
  };
}

const sendInputSchema = z.object({
  to: gmailHeaderValue.refine((value) => value.trim().length > 0),
  cc: gmailHeaderValue.optional(),
  subject: gmailHeaderValue,
  body: z.string(),
  replyToMessageId: gmailResourceId.optional(),
  replyThreadId: gmailResourceId.optional(),
}).strict().refine((input) => (input.replyToMessageId === undefined) === (input.replyThreadId === undefined));
const sentMessageSchema = z.object({ id: gmailResourceId, threadId: gmailResourceId });
