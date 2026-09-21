import { z } from "zod";
import type { ToolDef } from "#core/modules/module-types.js";
import { type OutboundHttpRequestPort, outboundHttp } from "#core/outbound-http/index.js";
import { networkDestructiveEffect, networkReadEffect } from "#core/tools/effect.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { apiError, googleFetch } from "./auth.js";

const MAX_LIST_PAGES = 10;
const eventTimeSchema = z.object({
  dateTime: z.string().optional(),
  date: z.string().optional(),
});
const eventPageSchema = z.object({
  kind: z.literal("calendar#events").optional(),
  items: z.array(z.object({
    id: z.string().min(1),
    summary: z.string().optional(),
    start: eventTimeSchema.optional(),
    end: eventTimeSchema.optional(),
    location: z.string().optional(),
    attendees: z.array(z.object({ email: z.string().optional() })).optional(),
  })).optional(),
  nextPageToken: z.string().min(1).optional(),
}).refine((page) => page.items !== undefined || page.nextPageToken !== undefined || page.kind !== undefined);

function calendarListResult(
  events: NonNullable<z.infer<typeof eventPageSchema>["items"]>,
  state: { kind: "complete" } | { kind: "partial" | "unavailable"; reason: string },
): ToolResult {
  if (state.kind === "complete" && events.length === 0) {
    return { content: "No upcoming events found." };
  }
  const lines = events.map((e) => {
    const start = e.start?.dateTime ?? e.start?.date ?? "?";
    const end = e.end?.dateTime ?? e.end?.date ?? "?";
    const attendees = (e.attendees ?? []).map((a) => a.email).filter(Boolean).join(", ");
    const parts = [
      `[${e.id}] ${e.summary ?? "(no title)"}`,
      `  Start: ${start} → ${end}`,
    ];
    if (e.location) parts.push(`  Location: ${e.location}`);
    if (attendees) parts.push(`  Attendees: ${attendees}`);
    return parts.join("\n");
  });
  const status = state.kind === "complete"
    ? "Complete results for the requested window."
    : `Incomplete results: ${state.reason} Additional matching events may exist.`;
  return {
    content: `${status}\n\n${events.length} event(s) retrieved:\n\n${lines.join("\n\n")}`,
    ...(state.kind === "unavailable" ? { is_error: true } : {}),
  };
}

export function makeCalendarListEvents(
  getToken: () => Promise<string>,
  calendarId: string,
  http: OutboundHttpRequestPort = outboundHttp,
): ToolDef {
  return {
    effect: networkReadEffect(),
    group: "productivity",
    tool: {
      name: "calendar_list_events",
      description:
        `List upcoming Google Calendar events. Returns title, time, location, and attendees. Follows up to ${MAX_LIST_PAGES} pages within maxResults and explicitly reports incomplete or unavailable results. Narrow the time window or increase maxResults (up to 50) when a limit is reached.`,
      input_schema: {
        type: "object" as const,
        properties: {
          maxResults: {
            type: "integer",
            minimum: 1,
            description: "Maximum number of events (default: 10, max: 50)",
          },
          timeMin: {
            type: "string",
            description: "Event end time lower bound (exclusive) as ISO 8601 (default: now)",
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
      const cal = (input.calendarId as string | undefined) ?? calendarId;
      const requestedMax = input.maxResults ?? 10;
      if (typeof requestedMax !== "number" || !Number.isInteger(requestedMax) || requestedMax < 1) {
        return { content: "maxResults must be a positive integer.", is_error: true };
      }
      const max = Math.min(requestedMax, 50);
      const timeMin = (input.timeMin as string | undefined) ?? new Date().toISOString();

      const params = new URLSearchParams({
        maxResults: String(max),
        orderBy: "startTime",
        singleEvents: "true",
        timeMin,
      });
      if (input.timeMax) params.set("timeMax", input.timeMax as string);

      const events: NonNullable<z.infer<typeof eventPageSchema>["items"]> = [];
      const seenTokens = new Set<string>();
      try {
        const token = await getToken();
        for (let page = 0; page < MAX_LIST_PAGES; page++) {
          const remaining = max - events.length;
          params.set("maxResults", String(remaining));
          const res = await googleFetch(
            token,
            "GET",
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events?${params}`,
            undefined,
            http,
          );
          if (!res.ok) {
            return calendarListResult(events, {
              kind: "unavailable",
              reason: `Google API error (${res.status}) while listing events.`,
            });
          }
          const parsed = eventPageSchema.safeParse(res.data);
          if (!parsed.success) {
            return calendarListResult(events, {
              kind: "unavailable",
              reason: "Google returned an invalid event page.",
            });
          }
          const items = parsed.data.items ?? [];
          events.push(...items.slice(0, remaining));
          const next = parsed.data.nextPageToken;
          if (items.length > remaining || (events.length === max && next)) {
            return calendarListResult(events, {
              kind: "partial",
              reason: `The ${max}-event limit was reached. Increase maxResults (up to 50) or narrow the time window.`,
            });
          }
          if (!next) return calendarListResult(events, { kind: "complete" });
          if (seenTokens.has(next)) {
            return calendarListResult(events, {
              kind: "unavailable",
              reason: "Google repeated a continuation token; retrieval stopped.",
            });
          }
          seenTokens.add(next);
          params.set("pageToken", next);
        }
      } catch {
        return calendarListResult(events, {
          kind: "unavailable",
          reason: "The calendar request failed; retrieval stopped. Try again later.",
        });
      }
      return calendarListResult(events, {
        kind: "partial",
        reason: `The ${MAX_LIST_PAGES}-page limit was reached. Narrow the time window.`,
      });
    },
  };
}

export function makeCalendarCreateEvent(
  getToken: () => Promise<string>,
  calendarId: string,
  http: OutboundHttpRequestPort = outboundHttp,
): ToolDef {
  return {
    effect: networkDestructiveEffect(),
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
        http,
      );
      if (!res.ok) return apiError("create event", res.status, res.data);

      const event = res.data as { id: string; summary?: string; htmlLink?: string };
      return {
        content: `Event created: ${event.summary ?? "(no title)"}\nID: ${event.id}\n${event.htmlLink ?? ""}`,
      };
    },
  };
}
