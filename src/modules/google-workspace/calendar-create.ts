import { z } from "zod";
import { fingerprintIdempotencyParams, type IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type { ToolDef } from "#core/modules/module-types.js";
import { type OutboundHttpRequestPort, outboundHttp } from "#core/outbound-http/index.js";
import { networkDestructiveEffect, networkReadEffect } from "#core/tools/effect.js";
import type { ToolRunnerContext } from "#core/tools/tool-registry.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { googleFetch } from "./auth.js";

const inputSchema = z.strictObject({
  operationId: z.uuid().describe("Fresh random UUID for a new meeting. Preserve it and all parameters for checks and authorized repeats; never derive it from meeting details."),
  summary: z.string().min(1).describe("Event title"),
  start: z.iso.datetime({ offset: true }).describe("Start time with UTC offset"),
  end: z.iso.datetime({ offset: true }).describe("End time with UTC offset, after start"),
  description: z.string().optional(),
  location: z.string().optional(),
  attendees: z.array(z.email()).optional(),
  calendarId: z.string().min(1).optional().describe("Calendar ID; defaults to the configured calendar"),
});
type Input = z.infer<typeof inputSchema>;
const calendarSchema = z.object({ id: z.string().min(1) });
const eventSchema = z.object({
  id: z.string().min(1),
  status: z.literal("confirmed"),
  summary: z.string(),
  start: z.object({ dateTime: z.iso.datetime({ offset: true }) }),
  end: z.object({ dateTime: z.iso.datetime({ offset: true }) }),
  description: z.string().optional(),
  location: z.string().optional(),
  attendees: z.array(z.object({ email: z.string() })).optional(),
  creator: z.object({ email: z.string() }),
  organizer: z.object({ email: z.string() }),
  extendedProperties: z.object({ private: z.object({ kotaOperation: z.string(), kotaParameters: z.string() }) }),
  htmlLink: z.url().optional(),
});
type Outcome = "confirmed" | "not_submitted" | "uncertain" | "absent" | "conflict";
function result(outcome: Outcome, operationId: string, detail: string): ToolResult {
  const guidance = outcome === "confirmed"
    ? "Do not create it again. A deliberate second meeting requires a new operationId."
    : "Keep this operationId and the original parameters. Use calendar_check_event to inspect the provider without writing. Only an authorized calendar_create_event repeat may complete this same operation; do not substitute a new ID to recover it.";
  return {
    content: `Calendar outcome: ${outcome}. ${detail}\nOperation: ${operationId}\n${guidance}`,
    structuredContent: { outcome, operationId },
    ...(outcome === "confirmed" || outcome === "absent" ? {} : { is_error: true }),
  };
}
function emails(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.toLowerCase()))].sort();
}
function eventFields(input: Input) {
  return {
    summary: input.summary,
    start: { dateTime: new Date(input.start).toISOString() },
    end: { dateTime: new Date(input.end).toISOString() },
    description: input.description ?? "",
    location: input.location ?? "",
    attendees: emails(input.attendees ?? []).map((email) => ({ email })),
  };
}

export function makeCalendarCreateTools(options: {
  getToken: () => Promise<string>;
  calendarId: string;
  defaultScopeId: string;
  resolveStore: (scopeId: string) => IdempotencyStore | null;
  http?: OutboundHttpRequestPort;
}): ToolDef[] {
  const http = options.http ?? outboundHttp;
  const active = new Set<string>();
  async function run(raw: Record<string, unknown>, context: ToolRunnerContext | undefined, write: boolean): Promise<ToolResult> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success || Date.parse(parsed.data.end) <= Date.parse(parsed.data.start)) {
      return { content: "Not submitted: supply an operationId UUID and valid event parameters (end must follow start). Reuse the original ID and parameters for recovery.", is_error: true };
    }
    const input = parsed.data;
    const scopeId = context?.scopeId ?? options.defaultScopeId;
    const key = `google-calendar:create:${input.operationId}`;
    const lock = `${scopeId}:${key}`;
    if (write && active.has(lock)) return result("uncertain", input.operationId, "This operation is already running. No additional write was submitted.");
    if (write) active.add(lock);
    let submitted = false;
    try {
      const store = options.resolveStore(scopeId);
      if (!store || store.getDefaultScopeId() !== scopeId) {
        return result("not_submitted", input.operationId, "The selected scope's durable operation store is unavailable. This attempt issued no write; any earlier outcome remains unknown.");
      }
      const token = await options.getToken();
      const base = "https://www.googleapis.com/calendar/v3/calendars/";
      // Resolve primary under these credentials: a shared calendar alone cannot identify the user.
      const primary = await googleFetch(token, "GET", `${base}primary`, undefined, http);
      const account = calendarSchema.safeParse(primary.data);
      if (!primary.ok || !account.success) throw new Error("Account unavailable");
      const requestedCalendar = input.calendarId ?? options.calendarId;
      const target = requestedCalendar === "primary" ? primary
        : await googleFetch(token, "GET", `${base}${encodeURIComponent(requestedCalendar)}`, undefined, http);
      const calendar = calendarSchema.safeParse(target.data);
      if (!target.ok || !calendar.success) throw new Error("Calendar unavailable");
      const identity = { scopeId, account: account.data.id, calendar: calendar.data.id, operationId: input.operationId };
      const eventId = fingerprintIdempotencyParams(identity);
      const fields = eventFields(input);
      const fingerprint = fingerprintIdempotencyParams({ ...identity, ...fields });
      const existing = store.get(scopeId, "provider-write", key);
      if (existing && (existing.retention.kind !== "retain" || existing.status === "expired")) {
        return result("uncertain", input.operationId, "The local operation record has an unsupported retention state. No write was submitted; restore the retained record before completing this operation.");
      }
      if (existing && existing.parameterFingerprint !== fingerprint) {
        return result("conflict", input.operationId, "The operation is bound to different parameters, account or calendar. No write was submitted.");
      }
      if (write && !existing) {
        // Retain intent, not a cached transport result. Both approval paths enter this runner.
        const claim = store.record({ scopeId, operation: "provider-write", key, parameterFingerprint: fingerprint,
          retention: { kind: "retain" }, result: { eventId } });
        if (claim.status !== "accepted") return result("uncertain", input.operationId, "Operation ownership changed. No write was submitted; check again.");
      }
      const url = `${base}${encodeURIComponent(calendar.data.id)}/events`;
      const verify = (data: unknown): ToolResult => {
        const event = eventSchema.safeParse(data);
        if (!event.success) return result("uncertain", input.operationId, "Google returned no usable confirmed event. Creation is not verified.");
        const value = event.data;
        if (value.id !== eventId || value.extendedProperties.private.kotaOperation !== eventId
          || value.extendedProperties.private.kotaParameters !== fingerprint
          || value.creator.email.toLowerCase() !== account.data.id.toLowerCase()
          || value.organizer.email.toLowerCase() !== calendar.data.id.toLowerCase()
          || fingerprintIdempotencyParams(eventFields({ ...input,
            summary: value.summary, start: value.start.dateTime, end: value.end.dateTime,
            description: value.description, location: value.location,
            attendees: value.attendees?.map((attendee) => attendee.email),
          })) !== fingerprintIdempotencyParams(fields)) {
          return result("conflict", input.operationId, "The provider event does not match this operation's identity and details. No success is claimed; inspect the event before proceeding.");
        }
        return result("confirmed", input.operationId, `Verified event: ${value.summary}\nID: ${eventId}\n${value.htmlLink ?? ""}`);
      };
      const found = await googleFetch(token, "GET", `${url}/${eventId}`, undefined, http);
      if (found.ok) return verify(found.data);
      if (found.status !== 404) return result("uncertain", input.operationId, `Provider lookup unavailable (${found.status}). No write was submitted; retry the read-only check later.`);
      if (!write) return result("absent", input.operationId, "The provider currently returns not found. This does not prove an earlier attempt never committed. An authorized repeat can attempt completion with the same event identity.");
      submitted = true;
      const created = await googleFetch(token, "POST", url, {
        ...fields, id: eventId,
        extendedProperties: { private: { kotaOperation: eventId, kotaParameters: fingerprint } },
      }, http);
      if (created.ok) return verify(created.data);
      if (created.status === 409) {
        const collision = await googleFetch(token, "GET", `${url}/${eventId}`, undefined, http);
        if (collision.ok) return verify(collision.data);
      }
      return result("uncertain", input.operationId, `Google did not confirm creation (${created.status}). The event may exist; check before any authorized repeat.`);
    } catch {
      return result(submitted ? "uncertain" : "not_submitted", input.operationId, submitted
        ? "No usable write response was received. The event may already exist."
        : "This attempt issued no write because authentication, lookup or durable recording failed. Any earlier attempt's outcome remains unknown.");
    } finally {
      if (write) active.delete(lock);
    }
  }
  const schema = z.toJSONSchema(inputSchema, { target: "draft-7" });
  if (!schema.properties) throw new Error("Calendar input schema must declare properties");
  const toolSchema = { ...schema, type: "object" as const, properties: schema.properties };
  return [
    {
      group: "productivity", effect: networkDestructiveEffect(),
      tool: { name: "calendar_create_event", description: "Create or complete one Google Calendar operation. Choose a fresh random operationId UUID before the first approval, then preserve it and every parameter for recovery. Requires operator approval in autonomous mode. An uncertain or redacted queued-approval result must be checked with calendar_check_event. Repeats verify the provider before writing with the same event ID. Never use a new ID for recovery; use one only for an intentional second meeting.", input_schema: toolSchema },
      runner: (input, context) => run(input, context, true),
    },
    {
      group: "productivity", effect: networkReadEffect(),
      tool: { name: "calendar_check_event", description: "Read-only reconciliation of a Calendar create, including after a failed or redacted queued approval. Supply its original operationId and event parameters. Verifies provider identity and details; never writes an event. A not-found result is not proof that a write never committed. Completing an absent operation requires an authorized calendar_create_event repeat with the same inputs.", input_schema: toolSchema },
      runner: (input, context) => run(input, context, false),
    },
  ];
}
