import { afterEach, describe, expect, it, vi } from "vitest";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { makeCalendarCreateEvent, makeCalendarListEvents } from "./calendar.js";

let requestMock = vi.fn();
const http = outboundHttpRequestPort((request) =>
  requestMock(String(request.url), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
  })
);

function mockGetToken(token = "test-token") {
  return vi.fn().mockResolvedValue(token);
}

function stubFetch(response: { ok?: boolean; status?: number; data?: unknown }) {
  const { ok = true, status = 200, data = {} } = response;
  requestMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

afterEach(() => {
  requestMock = vi.fn();
  vi.restoreAllMocks();
});

describe("calendar_list_events: runner", () => {
  it("returns 'No upcoming events' on empty list", async () => {
    const def = makeCalendarListEvents(mockGetToken(), "primary", http);
    stubFetch({ data: { items: [] } });

    const result = await def.runner({});
    expect(result.content).toBe("No upcoming events found.");
  });

  it("accepts an empty Google event collection with omitted items", async () => {
    stubFetch({ data: { kind: "calendar#events" } });
    const result = await makeCalendarListEvents(mockGetToken(), "primary", http).runner({});
    expect(result.content).toBe("No upcoming events found.");
  });

  it("formats events with summary, time, location, and attendees", async () => {
    const def = makeCalendarListEvents(mockGetToken(), "primary", http);
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
    const def = makeCalendarListEvents(mockGetToken(), "primary", http);
    stubFetch({ data: { items: [] } });

    await def.runner({ maxResults: 200 });
    const url = (requestMock as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("maxResults=50");
  });

  it("uses input calendarId over default", async () => {
    const def = makeCalendarListEvents(mockGetToken(), "primary", http);
    stubFetch({ data: { items: [] } });

    await def.runner({ calendarId: "custom-cal" });
    const url = (requestMock as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("custom-cal");
  });

  it("returns error on API failure", async () => {
    const def = makeCalendarListEvents(mockGetToken(), "primary", http);
    stubFetch({ ok: false, status: 403, data: { error: { message: "Forbidden" } } });

    const result = await def.runner({});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("403");
  });

  it("follows empty and short pages while preserving the calendar and time window", async () => {
    const responses = [
      { items: [], nextPageToken: "page 2/+" },
      { items: [{ id: "first", summary: "Standup" }], nextPageToken: "page3" },
      { items: [{ id: "second", summary: "Lunch" }] },
    ];
    requestMock.mockImplementation(async () => Response.json(responses.shift()));
    const result = await makeCalendarListEvents(mockGetToken(), "primary", http).runner({
      calendarId: "team/example@calendar.test",
      timeMin: "2026-09-21T00:00:00Z",
      timeMax: "2026-09-22T00:00:00Z",
      maxResults: 2,
    });

    expect(result.is_error).not.toBe(true);
    expect(result.content).toContain("Complete results");
    expect(result.content).toContain("Standup");
    expect(result.content).toContain("Lunch");
    expect(requestMock).toHaveBeenCalledTimes(3);
    const urls = requestMock.mock.calls.map(([url]) => new URL(url));
    for (const url of urls) {
      expect(decodeURIComponent(url.pathname)).toBe(
        "/calendar/v3/calendars/team/example@calendar.test/events",
      );
      expect(url.searchParams.get("timeMin")).toBe("2026-09-21T00:00:00Z");
      expect(url.searchParams.get("timeMax")).toBe("2026-09-22T00:00:00Z");
      expect(url.searchParams.get("orderBy")).toBe("startTime");
      expect(url.searchParams.get("singleEvents")).toBe("true");
    }
    expect(urls.map((url) => url.searchParams.get("pageToken"))).toEqual([
      null, "page 2/+", "page3",
    ]);
    expect(urls.map((url) => url.searchParams.get("maxResults"))).toEqual(["2", "2", "1"]);
  });

  it("captures the default time lower bound once across pages", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-21T00:00:00Z"));
      requestMock.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date("2026-09-21T01:00:00Z"));
        return Response.json({ nextPageToken: "next" });
      }).mockResolvedValueOnce(Response.json({ items: [] }));
      const result = await makeCalendarListEvents(mockGetToken(), "primary", http).runner({});
      expect(result.content).toBe("No upcoming events found.");
      expect(requestMock).toHaveBeenCalledTimes(2);
      for (const [url] of requestMock.mock.calls) {
        expect(new URL(url).searchParams.get("timeMin")).toBe("2026-09-21T00:00:00.000Z");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports incomplete results when the event limit stops retrieval", async () => {
    stubFetch({ data: { items: [{ id: "kept" }], nextPageToken: "more" } });
    const result = await makeCalendarListEvents(mockGetToken(), "primary", http).runner({
      maxResults: 1,
    });
    expect(result.content).toContain("Incomplete results");
    expect(result.content).toContain("1-event limit");
    expect(result.content).toContain("[kept]");
    expect(result.is_error).not.toBe(true);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["HTTP failure", () => Response.json({}, { status: 503 }), "503"],
    ["transport failure", () => { throw new Error("secret transport detail"); }, "request failed"],
    ["malformed JSON", () => new Response("not json"), "invalid event page"],
    ["invalid items", () => Response.json({ items: [null] }), "invalid event page"],
    ["invalid token", () => Response.json({ nextPageToken: 123 }), "invalid event page"],
  ])("retains partial events on continuation %s", async (_name, response, reason) => {
    requestMock.mockResolvedValueOnce(Response.json({
      items: [{ id: "kept", summary: "Planning" }], nextPageToken: "next",
    })).mockImplementationOnce(response);
    const result = await makeCalendarListEvents(mockGetToken(), "primary", http).runner({});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Incomplete results");
    expect(result.content).toContain("Planning");
    expect(result.content).toContain(reason);
    expect(result.content).not.toContain("secret transport detail");
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("never claims no events after an empty page and continuation failure", async () => {
    requestMock.mockResolvedValueOnce(Response.json({ items: [], nextPageToken: "next" }))
      .mockResolvedValueOnce(Response.json({}, { status: 500 }));
    const result = await makeCalendarListEvents(mockGetToken(), "primary", http).runner({});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Incomplete results");
    expect(result.content).not.toContain("No upcoming events found");
  });

  it("stops cyclic continuation tokens", async () => {
    const tokens = ["a", "b", "a"];
    requestMock.mockImplementation(async () => Response.json({ nextPageToken: tokens.shift() }));
    const result = await makeCalendarListEvents(mockGetToken(), "primary", http).runner({});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("repeated a continuation token");
    expect(result.content).not.toContain("No upcoming events found");
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it("bounds retrieval even when empty pages keep returning distinct tokens", async () => {
    let page = 0;
    requestMock.mockImplementation(async () => Response.json({ nextPageToken: `page-${++page}` }));
    const result = await makeCalendarListEvents(mockGetToken(), "primary", http).runner({});
    expect(result.content).toContain("Incomplete results");
    expect(result.content).toContain("10-page limit");
    expect(result.content).not.toContain("No upcoming events found");
    expect(requestMock).toHaveBeenCalledTimes(10);
  });

  it("bounds output if Google sends more events than requested", async () => {
    stubFetch({ data: { items: [{ id: "kept" }, { id: "omitted" }] } });
    const result = await makeCalendarListEvents(mockGetToken(), "primary", http).runner({ maxResults: 1 });
    expect(result.content).toContain("Incomplete results");
    expect(result.content).toContain("[kept]");
    expect(result.content).not.toContain("[omitted]");
  });

  it.each([null, [], {}, { items: null }, { nextPageToken: "" }])(
    "rejects invalid first pages without claiming an empty calendar: %j",
    async (data) => {
      stubFetch({ data });
      const result = await makeCalendarListEvents(mockGetToken(), "primary", http).runner({});
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("invalid event page");
      expect(result.content).not.toContain("No upcoming events found");
      expect(requestMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "2"])(
    "rejects invalid result limits: %s",
    async (maxResults) => {
      const result = await makeCalendarListEvents(mockGetToken(), "primary", http).runner({ maxResults });
      expect(result.is_error).toBe(true);
      expect(requestMock).not.toHaveBeenCalled();
    },
  );
});

describe("calendar_create_event: runner", () => {
  it("creates event and returns link", async () => {
    const def = makeCalendarCreateEvent(mockGetToken(), "primary", http);
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
    const def = makeCalendarCreateEvent(mockGetToken(), "primary", http);
    stubFetch({ data: { id: "ev2", summary: "Meeting" } });

    await def.runner({
      summary: "Meeting",
      start: "2026-04-11T14:00:00Z",
      end: "2026-04-11T15:00:00Z",
      attendees: ["a@test.com", "b@test.com"],
    });

    const [, opts] = (requestMock as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.attendees).toEqual([{ email: "a@test.com" }, { email: "b@test.com" }]);
  });

  it("returns error on API failure", async () => {
    const def = makeCalendarCreateEvent(mockGetToken(), "primary", http);
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
