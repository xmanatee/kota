import type { ToolDef } from "../../core/modules/module-types.js";
import type { ToolResult } from "../../core/tools/tool-result.js";
import { apiError, googleFetch } from "./auth.js";

export function makeCalendarListEvents(
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

export function makeCalendarCreateEvent(
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
