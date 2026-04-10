/**
 * Google Workspace module — Gmail, Calendar, and Drive tools for agents.
 *
 * Tools:
 *   gmail_list_messages  — list recent Gmail messages with optional query filter
 *   gmail_get_message    — get full body of a Gmail message by ID
 *   gmail_send           — send a Gmail message
 *   calendar_list_events — list upcoming Calendar events
 *   calendar_create_event — create a Calendar event
 *   drive_list_files     — list Drive files with optional query filter
 *   drive_read_file      — read plain text content of a Drive file
 *
 * Config (under modules.google-workspace):
 *   clientId:     OAuth 2.0 client ID or $ENV_VAR reference. Required.
 *   clientSecret: OAuth 2.0 client secret or $ENV_VAR reference. Required.
 *   refreshToken: OAuth 2.0 refresh token or $ENV_VAR reference. Required.
 *   userId:       Gmail/Calendar user (default: "me")
 *   calendarId:   Calendar ID (default: "primary")
 *
 * Auth setup:
 *   1. Create an OAuth 2.0 client in Google Cloud Console (Desktop app type).
 *   2. Enable Gmail API, Google Calendar API, and Google Drive API.
 *   3. Run the OAuth consent flow to get a refresh token with scopes:
 *      https://www.googleapis.com/auth/gmail.modify
 *      https://www.googleapis.com/auth/calendar
 *      https://www.googleapis.com/auth/drive.readonly
 *   4. Store credentials in .kota/config.json under modules.google-workspace,
 *      or use $ENV_VAR references to environment variables.
 *
 * Uses Node fetch; no npm dependencies beyond what Node 18+ provides.
 */

import type { KotaModule, ModuleContext, ToolDef } from "../../module-types.js";
import type { ToolResult } from "../../tools/tool-result.js";

// ─── Config ──────────────────────────────────────────────────────────────────

type GoogleWorkspaceConfig = {
  /** OAuth 2.0 client ID or $ENV_VAR reference. Required. */
  clientId: string;
  /** OAuth 2.0 client secret or $ENV_VAR reference. Required. */
  clientSecret: string;
  /** OAuth 2.0 refresh token or $ENV_VAR reference. Required. */
  refreshToken: string;
  /** Gmail user ID (default: "me") */
  userId?: string;
  /** Calendar ID (default: "primary") */
  calendarId?: string;
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

function resolveEnv(raw: string): string {
  if (raw.startsWith("$")) {
    return process.env[raw.slice(1)] ?? "";
  }
  return raw;
}

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

async function getAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.accessToken;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return tokenCache.accessToken;
}

async function googleFetch(
  token: string,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function apiError(action: string, status: number, data: unknown): ToolResult {
  const msg = (data as { error?: { message?: string } })?.error?.message ?? JSON.stringify(data);
  return { content: `Google API error (${status}) during ${action}: ${msg}`, is_error: true };
}

// ─── Tool factories ───────────────────────────────────────────────────────────

function makeGmailListMessages(
  getToken: () => Promise<string>,
  userId: string,
): ToolDef {
  return {
    risk: "safe",
    kind: "discovery",
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

      // Fetch metadata for each message in parallel (batch limit to avoid rate limits)
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

function makeGmailGetMessage(
  getToken: () => Promise<string>,
  userId: string,
): ToolDef {
  return {
    risk: "safe",
    kind: "discovery",
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

      // Extract body — prefer plain text
      let body = "";
      const parts = msg.payload?.parts ?? [];
      const plainPart = parts.find((p) => p.mimeType === "text/plain");
      const rawData =
        plainPart?.body?.data ?? msg.payload?.body?.data;
      if (rawData) {
        body = Buffer.from(rawData, "base64url").toString("utf-8");
      } else {
        body = msg.snippet;
      }

      return {
        content: [
          `Subject: ${subject}`,
          `From: ${from}`,
          `To: ${to}`,
          `Date: ${date}`,
          "",
          body,
        ].join("\n"),
      };
    },
  };
}

function makeGmailSend(
  getToken: () => Promise<string>,
  userId: string,
): ToolDef {
  return {
    risk: "dangerous",
    kind: "action",
    group: "productivity",
    tool: {
      name: "gmail_send",
      description:
        "Send a Gmail message. Requires operator approval in autonomous mode.",
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

      const raw = Buffer.from(lines.join("\r\n"))
        .toString("base64url");

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

function makeCalendarListEvents(
  getToken: () => Promise<string>,
  calendarId: string,
): ToolDef {
  return {
    risk: "safe",
    kind: "discovery",
    group: "productivity",
    tool: {
      name: "calendar_list_events",
      description:
        "List upcoming Google Calendar events. Returns title, time, location, and attendees.",
      input_schema: {
        type: "object" as const,
        properties: {
          maxResults: {
            type: "number",
            description: "Maximum number of events (default: 10, max: 50)",
          },
          timeMin: {
            type: "string",
            description: "Start time lower bound as ISO 8601 (default: now)",
          },
          timeMax: {
            type: "string",
            description: "Start time upper bound as ISO 8601 (optional)",
          },
          calendarId: {
            type: "string",
            description: "Calendar ID (default: configured or 'primary')",
          },
        },
        required: [],
      },
    },
    async runner(input): Promise<ToolResult> {
      const token = await getToken();
      const cal = (input.calendarId as string | undefined) ?? calendarId;
      const max = Math.min((input.maxResults as number | undefined) ?? 10, 50);
      const timeMin = (input.timeMin as string | undefined) ?? new Date().toISOString();

      const params = new URLSearchParams({
        maxResults: String(max),
        orderBy: "startTime",
        singleEvents: "true",
        timeMin,
      });
      if (input.timeMax) params.set("timeMax", input.timeMax as string);

      const res = await googleFetch(
        token,
        "GET",
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events?${params}`,
      );
      if (!res.ok) return apiError("list events", res.status, res.data);

      const data = res.data as {
        items?: Array<{
          id: string;
          summary?: string;
          start?: { dateTime?: string; date?: string };
          end?: { dateTime?: string; date?: string };
          location?: string;
          attendees?: Array<{ email: string; responseStatus?: string }>;
          description?: string;
        }>;
      };

      const events = data.items ?? [];
      if (events.length === 0) return { content: "No upcoming events found." };

      const lines = events.map((e) => {
        const start = e.start?.dateTime ?? e.start?.date ?? "?";
        const end = e.end?.dateTime ?? e.end?.date ?? "?";
        const attendees = (e.attendees ?? []).map((a) => a.email).join(", ");
        const parts = [
          `[${e.id}] ${e.summary ?? "(no title)"}`,
          `  Start: ${start} → ${end}`,
        ];
        if (e.location) parts.push(`  Location: ${e.location}`);
        if (attendees) parts.push(`  Attendees: ${attendees}`);
        return parts.join("\n");
      });

      return { content: `${events.length} event(s):\n\n${lines.join("\n\n")}` };
    },
  };
}

function makeCalendarCreateEvent(
  getToken: () => Promise<string>,
  calendarId: string,
): ToolDef {
  return {
    risk: "dangerous",
    kind: "action",
    group: "productivity",
    tool: {
      name: "calendar_create_event",
      description:
        "Create a Google Calendar event. Requires operator approval in autonomous mode.",
      input_schema: {
        type: "object" as const,
        properties: {
          summary: { type: "string", description: "Event title" },
          start: {
            type: "string",
            description: "Start time as ISO 8601 (e.g. 2026-04-10T10:00:00-07:00)",
          },
          end: {
            type: "string",
            description: "End time as ISO 8601",
          },
          description: { type: "string", description: "Event description (optional)" },
          location: { type: "string", description: "Event location (optional)" },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "List of attendee email addresses (optional)",
          },
          calendarId: {
            type: "string",
            description: "Calendar ID (default: configured or 'primary')",
          },
        },
        required: ["summary", "start", "end"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const token = await getToken();
      const cal = (input.calendarId as string | undefined) ?? calendarId;

      const body: Record<string, unknown> = {
        summary: input.summary,
        start: { dateTime: input.start },
        end: { dateTime: input.end },
      };
      if (input.description) body.description = input.description;
      if (input.location) body.location = input.location;
      if (Array.isArray(input.attendees) && input.attendees.length > 0) {
        body.attendees = (input.attendees as string[]).map((email) => ({ email }));
      }

      const res = await googleFetch(
        token,
        "POST",
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events`,
        body,
      );
      if (!res.ok) return apiError("create event", res.status, res.data);

      const event = res.data as { id: string; summary?: string; htmlLink?: string };
      return {
        content: `Event created: ${event.summary ?? "(no title)"}\nID: ${event.id}\n${event.htmlLink ?? ""}`,
      };
    },
  };
}

function makeDriveListFiles(getToken: () => Promise<string>): ToolDef {
  return {
    risk: "safe",
    kind: "discovery",
    group: "productivity",
    tool: {
      name: "drive_list_files",
      description:
        "List Google Drive files with an optional search query. " +
        "Returns file names, IDs, MIME types, and modification times.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description:
              "Drive search query (e.g. \"name contains 'budget'\" or \"mimeType='application/pdf'\")",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of files to return (default: 20, max: 100)",
          },
        },
        required: [],
      },
    },
    async runner(input): Promise<ToolResult> {
      const token = await getToken();
      const max = Math.min((input.maxResults as number | undefined) ?? 20, 100);
      const params = new URLSearchParams({
        pageSize: String(max),
        fields: "files(id,name,mimeType,modifiedTime,size)",
        orderBy: "modifiedTime desc",
      });
      if (input.query) params.set("q", input.query as string);

      const res = await googleFetch(
        token,
        "GET",
        `https://www.googleapis.com/drive/v3/files?${params}`,
      );
      if (!res.ok) return apiError("list files", res.status, res.data);

      const data = res.data as {
        files?: Array<{
          id: string;
          name: string;
          mimeType: string;
          modifiedTime?: string;
          size?: string;
        }>;
      };

      const files = data.files ?? [];
      if (files.length === 0) return { content: "No files found." };

      const lines = files.map((f) => {
        const size = f.size ? ` (${Math.round(Number(f.size) / 1024)}KB)` : "";
        return `[${f.id}] ${f.name}${size}\n  Type: ${f.mimeType} | Modified: ${f.modifiedTime ?? "?"}`;
      });

      return { content: `${files.length} file(s):\n\n${lines.join("\n\n")}` };
    },
  };
}

function makeDriveReadFile(getToken: () => Promise<string>): ToolDef {
  return {
    risk: "safe",
    kind: "discovery",
    group: "productivity",
    tool: {
      name: "drive_read_file",
      description:
        "Read the plain text content of a Google Drive file by its ID. " +
        "Google Docs are exported as plain text; other text files are downloaded directly.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Drive file ID" },
          maxChars: {
            type: "number",
            description: "Maximum characters to return (default: 8000)",
          },
        },
        required: ["id"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const token = await getToken();
      const fileId = input.id as string;
      const maxChars = (input.maxChars as number | undefined) ?? 8000;

      // First, get file metadata to determine MIME type
      const metaRes = await googleFetch(
        token,
        "GET",
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType`,
      );
      if (!metaRes.ok) return apiError("get file metadata", metaRes.status, metaRes.data);

      const meta = metaRes.data as { name: string; mimeType: string };

      // Export Google Workspace documents as plain text; download others directly
      let url: string;
      if (meta.mimeType === "application/vnd.google-apps.document") {
        url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
      } else if (meta.mimeType === "application/vnd.google-apps.spreadsheet") {
        url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`;
      } else {
        url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      }

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.text();
        return { content: `Google Drive error (${res.status}): ${body}`, is_error: true };
      }

      const text = await res.text();
      const truncated = text.length > maxChars;
      const content = truncated ? text.slice(0, maxChars) + "\n... (truncated)" : text;

      return {
        content: `File: ${meta.name}\nType: ${meta.mimeType}\n\n${content}`,
      };
    },
  };
}

// ─── Module ───────────────────────────────────────────────────────────────────

const googleWorkspaceModule: KotaModule = {
  name: "google-workspace",
  version: "1.0.0",
  description: "Gmail, Calendar, and Drive tools for agents",

  tools(ctx: ModuleContext): ToolDef[] {
    const config = ctx.getModuleConfig<GoogleWorkspaceConfig>();

    if (!config?.clientId || !config?.clientSecret || !config?.refreshToken) {
      ctx.log.warn(
        "Google Workspace module: modules.google-workspace.clientId, clientSecret, and refreshToken are required — module inactive",
      );
      return [];
    }

    const clientId = resolveEnv(config.clientId);
    const clientSecret = resolveEnv(config.clientSecret);
    const refreshToken = resolveEnv(config.refreshToken);

    if (!clientId || !clientSecret || !refreshToken) {
      ctx.log.warn(
        "Google Workspace module: one or more required env vars are not set — module inactive",
      );
      return [];
    }

    const userId = config.userId ?? "me";
    const calendarId = config.calendarId ?? "primary";

    const getToken = () => getAccessToken(clientId, clientSecret, refreshToken);

    return [
      makeGmailListMessages(getToken, userId),
      makeGmailGetMessage(getToken, userId),
      makeGmailSend(getToken, userId),
      makeCalendarListEvents(getToken, calendarId),
      makeCalendarCreateEvent(getToken, calendarId),
      makeDriveListFiles(getToken),
      makeDriveReadFile(getToken),
    ];
  },
};

export default googleWorkspaceModule;
