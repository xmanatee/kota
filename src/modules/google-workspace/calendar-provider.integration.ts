import { randomUUID } from "node:crypto";
import { type OutboundHttpTelemetryEvent, OutboundHttpTransport } from "#core/outbound-http/index.js";

export function meeting() {
  return { operationId: randomUUID(), summary: "Planning", start: "2026-10-01T10:00:00Z", end: "2026-10-01T11:00:00Z", attendees: ["guest@example.com"] };
}

/** Controlled Google boundary; all local transport, persistence and approval behavior remains real. */
export class CalendarProvider {
  account = "owner@example.com";
  mode: "normal" | "lost-committed" | "lost-uncommitted" | "invalid-json" | "empty-body" | "collision" | "collision-matching" = "normal";
  readStatus = 200;
  events = new Map<string, Record<string, any>>();
  posts: Array<{ calendar: string; body: Record<string, any> }> = [];
  telemetry: OutboundHttpTelemetryEvent[] = [];
  http = new OutboundHttpTransport({
    resolveAddresses: async () => [{ address: "93.184.216.34", family: 4 }],
    telemetry: (event) => this.telemetry.push(event),
    dispatcher: async (url, init) => {
      const parts = url.pathname.split("/").map(decodeURIComponent);
      const calendar = parts[4] === "primary" ? this.account : parts[4];
      if (!parts[5]) return Response.json({ id: calendar });
      if (init.method !== "POST") {
        if (this.readStatus !== 200) return Response.json({}, { status: this.readStatus });
        const event = this.events.get(`${calendar}/${parts[6]}`);
        return Response.json(event ?? {}, { status: event ? 200 : 404 });
      }
      const body = JSON.parse(String(init.body));
      this.posts.push({ calendar, body });
      if (this.mode === "lost-uncommitted") throw new Error("Connection lost");
      const key = `${calendar}/${body.id}`;
      if (this.events.has(key)) return Response.json({}, { status: 409 });
      const event = { ...body, status: "confirmed", creator: { email: this.account }, organizer: { email: calendar }, htmlLink: `https://calendar.google.com/event/${body.id}` };
      this.events.set(key, event);
      if (this.mode === "lost-committed") throw new Error("Connection lost");
      if (this.mode === "invalid-json") return new Response("invalid json", { status: 200 });
      if (this.mode === "empty-body") return Response.json({});
      if (this.mode === "collision-matching") return Response.json({}, { status: 409 });
      if (this.mode === "collision") {
        this.events.set(key, { ...event, extendedProperties: { private: { kotaOperation: "unrelated", kotaParameters: "unrelated" } } });
        return Response.json({}, { status: 409 });
      }
      return Response.json(event);
    },
  });
}
