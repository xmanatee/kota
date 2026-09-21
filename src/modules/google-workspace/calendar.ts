import { z } from "zod";
import type { ToolDef } from "#core/modules/module-types.js";
import { type OutboundHttpRequestPort, outboundHttp } from "#core/outbound-http/index.js";
import { networkReadEffect } from "#core/tools/effect.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { googleFetch } from "./auth.js";

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
    status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
    transparency: z.enum(["opaque", "transparent"]).optional(),
    attendeesOmitted: z.boolean().optional(),
    attendees: z.array(z.object({
      email: z.string().optional(),
      displayName: z.string().optional(),
      id: z.string().optional(),
      self: z.boolean().default(false),
      responseStatus: z.enum(["needsAction", "declined", "tentative", "accepted"]).optional(),
    })).optional(),
  })).optional(),
  nextPageToken: z.string().min(1).optional(),
}).refine((page) => page.items !== undefined || page.nextPageToken !== undefined || page.kind !== undefined);

function calendarListResult(
  calendarId: string,
  events: NonNullable<z.infer<typeof eventPageSchema>["items"]>,
  state: { kind: "complete" } | { kind: "partial" | "unavailable"; reason: string },
): ToolResult {
  const lines = events.map((e) => {
    const start = e.start?.dateTime ?? e.start?.date ?? "?";
    const end = e.end?.dateTime ?? e.end?.date ?? "?";
    const attendees = e.attendees ?? [];
    const transparency = e.transparency ?? "opaque";
    const blocking = transparency === "opaque" ? "blocks time" : "does not block time";
    const parts = [
      `[${e.id}] ${e.summary ?? "(no title)"}`,
      `  Start: ${start} → ${end}`,
      `  Event status: ${e.status ?? "confirmed"}${e.status === undefined ? " (provider default)" : ""}`,
      `  Time-blocking setting: ${transparency} (${blocking}${e.transparency === undefined ? "; provider default" : ""})`,
    ];
    if (e.location) parts.push(`  Location: ${e.location}`);
    if (!attendees.some((a) => a.self)) {
      parts.push("  Selected calendar response: unknown (no self attendee supplied)");
    }
    if (e.attendeesOmitted) parts.push("  Attendee details incomplete: provider omitted attendees.");
    for (const [index, attendee] of attendees.entries()) {
      const identity = attendee.email ?? attendee.displayName ?? attendee.id ?? `Attendee ${index + 1} (identity not supplied)`;
      const response = attendee.responseStatus === "needsAction"
        ? "needsAction (unanswered)"
        : attendee.responseStatus ?? "unknown (not supplied)";
      parts.push(`  Attendee: ${identity} — ${attendee.self ? "selected calendar copy (self)" : "other attendee"}; response: ${response}`);
    }
    return parts.join("\n");
  });
  const status = state.kind === "complete"
    ? "Complete results for the requested window."
    : `Incomplete results: ${state.reason} Additional matching events may exist.`;
  return {
    content: [
      `Calendar: ${calendarId}`,
      status,
      "Event retrieval completeness does not establish everyone's availability. Time-blocking settings and attendee responses are separate.",
      "",
      state.kind === "complete" && events.length === 0
        ? "No upcoming events found."
        : `${events.length} event(s) retrieved:\n\n${lines.join("\n\n")}`,
    ].join("\n"),
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
        `List upcoming Google Calendar events. Returns title, time, location, event status, time-blocking settings, and attendee responses attributed to the selected calendar copy using provider self metadata. Includes nonblocking events; this agenda is not a full availability calculation. Follows up to ${MAX_LIST_PAGES} pages within maxResults and explicitly reports incomplete or unavailable results. Narrow the time window or increase maxResults (up to 50) when a limit is reached.`,
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
            return calendarListResult(cal, events, {
              kind: "unavailable",
              reason: `Google API error (${res.status}) while listing events.`,
            });
          }
          const parsed = eventPageSchema.safeParse(res.data);
          if (!parsed.success) {
            return calendarListResult(cal, events, {
              kind: "unavailable",
              reason: "Google returned an invalid event page.",
            });
          }
          const items = parsed.data.items ?? [];
          events.push(...items.slice(0, remaining));
          const next = parsed.data.nextPageToken;
          if (items.length > remaining || (events.length === max && next)) {
            return calendarListResult(cal, events, {
              kind: "partial",
              reason: `The ${max}-event limit was reached. Increase maxResults (up to 50) or narrow the time window.`,
            });
          }
          if (!next) return calendarListResult(cal, events, { kind: "complete" });
          if (seenTokens.has(next)) {
            return calendarListResult(cal, events, {
              kind: "unavailable",
              reason: "Google repeated a continuation token; retrieval stopped.",
            });
          }
          seenTokens.add(next);
          params.set("pageToken", next);
        }
      } catch {
        return calendarListResult(cal, events, {
          kind: "unavailable",
          reason: "The calendar request failed; retrieval stopped. Try again later.",
        });
      }
      return calendarListResult(cal, events, {
        kind: "partial",
        reason: `The ${MAX_LIST_PAGES}-page limit was reached. Narrow the time window.`,
      });
    },
  };
}
