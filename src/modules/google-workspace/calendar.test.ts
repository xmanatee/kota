import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCalendarCreateEvent, makeCalendarListEvents } from "./calendar.js";

const originalFetch = globalThis.fetch;

function mockGetToken(token = "test-token") {
  return vi.fn().mockResolvedValue(token);
}

function stubFetch(response: { ok?: boolean; status?: number; data?: unknown }) {
  const { ok = true, status = 200, data = {} } = response;
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("calendar_list_events: schema", () => {
  const def = makeCalendarListEvents(mockGetToken(), "primary");

  it("has correct tool name and metadata", () => {
    expect(def.tool.name).toBe("calendar_list_events");
    expect(def.risk).toBe("safe");
    expect(def.kind).toBe("discovery");
    expect(def.group).toBe("productivity");
  });

  it("has no required fields", () => {
    expect(def.tool.input_schema.required).toEqual([]);
  });
});

describe("calendar_list_events: runner", () => {
  it("returns 'No upcoming events' on empty list", async () => {
    const def = makeCalendarListEvents(mockGetToken(), "primary");
    stubFetch({ data: { items: [] } });

    const result = await def.runner({});
    expect(result.content).toBe("No upcoming events found.");
  });

  it("formats events with summary, time, location, and attendees", async () => {
    const def = makeCalendarListEvents(mockGetToken(), "primary");
    stubFetch({
      data: {
        items: [
          {
            id: "ev1",
            summary: "Standup",
            start: { dateTime: "2026-04-11T09:00:00Z" },
            end: { dateTime: "2026-04-11T09:30:00Z" },
            location: "Room A",
            attendees: [{ email: "alice@test.com" }],
          },
        ],
      },
    });

    const result = await def.runner({});
    expect(result.content).toContain("Standup");
    expect(result.content).toContain("2026-04-11T09:00:00Z");
    expect(result.content).toContain("Room A");
    expect(result.content).toContain("alice@test.com");
  });

  it("caps maxResults at 50", async () => {
    const def = makeCalendarListEvents(mockGetToken(), "primary");
    stubFetch({ data: { items: [] } });

    await def.runner({ maxResults: 200 });
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("maxResults=50");
  });

  it("uses input calendarId over default", async () => {
    const def = makeCalendarListEvents(mockGetToken(), "primary");
    stubFetch({ data: { items: [] } });

    await def.runner({ calendarId: "custom-cal" });
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("custom-cal");
  });

  it("returns error on API failure", async () => {
    const def = makeCalendarListEvents(mockGetToken(), "primary");
    stubFetch({ ok: false, status: 403, data: { error: { message: "Forbidden" } } });

    const result = await def.runner({});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("403");
  });
});

describe("calendar_create_event: schema", () => {
  const def = makeCalendarCreateEvent(mockGetToken(), "primary");

  it("has correct tool name and is marked dangerous", () => {
    expect(def.tool.name).toBe("calendar_create_event");
    expect(def.risk).toBe("dangerous");
    expect(def.kind).toBe("action");
  });

  it("requires summary, start, end", () => {
    expect(def.tool.input_schema.required).toEqual(["summary", "start", "end"]);
  });
});

describe("calendar_create_event: runner", () => {
  it("creates event and returns link", async () => {
    const def = makeCalendarCreateEvent(mockGetToken(), "primary");
    stubFetch({
      data: {
        id: "ev-new",
        summary: "New Event",
        htmlLink: "https://calendar.google.com/event/ev-new",
      },
    });

    const result = await def.runner({
      summary: "New Event",
      start: "2026-04-11T10:00:00Z",
      end: "2026-04-11T11:00:00Z",
    });

    expect(result.content).toContain("New Event");
    expect(result.content).toContain("ev-new");
    expect(result.content).toContain("https://calendar.google.com/event/ev-new");
  });

  it("sends attendees in body when provided", async () => {
    const def = makeCalendarCreateEvent(mockGetToken(), "primary");
    stubFetch({ data: { id: "ev2", summary: "Meeting" } });

    await def.runner({
      summary: "Meeting",
      start: "2026-04-11T14:00:00Z",
      end: "2026-04-11T15:00:00Z",
      attendees: ["a@test.com", "b@test.com"],
    });

    const [, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.attendees).toEqual([{ email: "a@test.com" }, { email: "b@test.com" }]);
  });

  it("returns error on API failure", async () => {
    const def = makeCalendarCreateEvent(mockGetToken(), "primary");
    stubFetch({ ok: false, status: 400, data: { error: { message: "Bad Request" } } });

    const result = await def.runner({
      summary: "X",
      start: "2026-04-11T10:00:00Z",
      end: "2026-04-11T11:00:00Z",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("400");
  });
});
