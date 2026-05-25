import type { ModuleContext } from "#core/modules/module-types.js";
import {
  type InboundSignalActorTrust,
  type InboundSignalJsonObject,
  type InboundSignalJsonValue,
  type InboundSignalReceivedPayload,
  type InboundSignalValidationResult,
  inboundSignalReceived,
  validateInboundSignalPayload,
} from "#modules/inbound-signals/events.js";

export type GoogleWorkspaceInboundTrustConfig = {
  trustedSenders?: readonly string[];
  blockedSenders?: readonly string[];
  trustedOrganizers?: readonly string[];
  blockedOrganizers?: readonly string[];
};

export type GoogleWorkspaceInboundSignalContext =
  GoogleWorkspaceInboundTrustConfig & {
    projectId: string;
    accountId: string;
    receivedAt: string;
  };

export type GoogleWorkspaceGmailMessage = {
  id: string;
  threadId: string;
  historyId?: string;
  labelIds?: readonly string[];
  snippet?: string;
  internalDate?: string;
  webLink?: string;
  headers: {
    from?: string;
    to?: string;
    cc?: string;
    subject?: string;
    date?: string;
    messageId?: string;
  };
  text: string;
};

export type GoogleWorkspaceCalendarActor = {
  email?: string;
  displayName?: string;
  self?: boolean;
};

export type GoogleWorkspaceCalendarDateTime = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

export type GoogleWorkspaceCalendarAttendee = GoogleWorkspaceCalendarActor & {
  responseStatus?: string;
};

export type GoogleWorkspaceCalendarEventChange = {
  id: string;
  calendarId: string;
  status: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  iCalUID?: string;
  recurringEventId?: string;
  created?: string;
  updated?: string;
  organizer?: GoogleWorkspaceCalendarActor;
  creator?: GoogleWorkspaceCalendarActor;
  start?: GoogleWorkspaceCalendarDateTime;
  end?: GoogleWorkspaceCalendarDateTime;
  attendees?: readonly GoogleWorkspaceCalendarAttendee[];
};

export type GoogleWorkspaceInboundEmitResult =
  | { emitted: true; payload: InboundSignalReceivedPayload }
  | { emitted: false; error: string };

export type GoogleWorkspaceInboundInputResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type ParsedMailbox = {
  email: string | null;
  displayName: string | null;
};

type TrustAssessment = {
  trust: InboundSignalActorTrust;
  trustReason: string;
};

function isNonEmptyString(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function clean(value: string | undefined | null): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}

function requireInputString(
  value: InboundSignalJsonValue | undefined,
  label: string,
): string {
  if (typeof value === "string" && value.trim().length > 0) return value;
  throw new Error(`${label} must be a non-empty string`);
}

function optionalInputString(
  value: InboundSignalJsonValue | undefined,
  label: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  throw new Error(`${label} must be a string`);
}

function optionalInputBoolean(
  value: InboundSignalJsonValue | undefined,
  label: string,
): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  throw new Error(`${label} must be a boolean`);
}

function optionalInputObject(
  value: InboundSignalJsonValue | undefined,
  label: string,
): InboundSignalJsonObject | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as InboundSignalJsonObject;
  }
  throw new Error(`${label} must be an object`);
}

function optionalInputArray(
  value: InboundSignalJsonValue | undefined,
  label: string,
): readonly InboundSignalJsonValue[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value;
  throw new Error(`${label} must be an array`);
}

function optionalInputStringArray(
  value: InboundSignalJsonValue | undefined,
  label: string,
): readonly string[] | undefined {
  const array = optionalInputArray(value, label);
  if (!array) return undefined;
  return array.map((item, index) =>
    requireInputString(item, `${label}[${index}]`),
  );
}

function nullableString(value: string | undefined | null): string | null {
  return clean(value);
}

function nullableBoolean(value: boolean | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseMailbox(value: string | undefined): ParsedMailbox {
  const raw = clean(value);
  if (!raw) return { email: null, displayName: null };

  const angleMatch = raw.match(/^(.*?)<([^<>@\s]+@[^<>\s]+)>$/);
  if (angleMatch) {
    const displayName = angleMatch[1]?.trim().replace(/^"|"$/g, "") ?? "";
    return {
      email: angleMatch[2]?.trim().toLowerCase() ?? null,
      displayName: clean(displayName),
    };
  }

  const emailMatch = raw.match(/[^@\s<>]+@[^@\s<>]+/);
  if (emailMatch) {
    return {
      email: emailMatch[0].toLowerCase(),
      displayName: null,
    };
  }

  return { email: null, displayName: raw };
}

function inputEnvelope(
  raw: InboundSignalJsonObject,
  field: string,
): InboundSignalJsonObject {
  return optionalInputObject(raw[field], field) ?? raw;
}

function gmailHeaderMap(rawHeaders: InboundSignalJsonValue | undefined): {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  date?: string;
  messageId?: string;
} {
  const headers = optionalInputArray(rawHeaders, "payload.headers");
  const out: {
    from?: string;
    to?: string;
    cc?: string;
    subject?: string;
    date?: string;
    messageId?: string;
  } = {};
  for (const [index, rawHeader] of (headers ?? []).entries()) {
    const header = optionalInputObject(rawHeader, `payload.headers[${index}]`);
    if (!header) continue;
    const name = requireInputString(header.name, `payload.headers[${index}].name`)
      .toLowerCase();
    const value = requireInputString(
      header.value,
      `payload.headers[${index}].value`,
    );
    if (name === "from") out.from = value;
    if (name === "to") out.to = value;
    if (name === "cc") out.cc = value;
    if (name === "subject") out.subject = value;
    if (name === "date") out.date = value;
    if (name === "message-id" || name === "messageid") out.messageId = value;
  }
  return out;
}

function gmailHeaders(raw: InboundSignalJsonObject): GoogleWorkspaceGmailMessage["headers"] {
  const explicitHeaders = optionalInputObject(raw.headers, "headers");
  if (explicitHeaders) {
    return {
      from: optionalInputString(explicitHeaders.from, "headers.from"),
      to: optionalInputString(explicitHeaders.to, "headers.to"),
      cc: optionalInputString(explicitHeaders.cc, "headers.cc"),
      subject: optionalInputString(explicitHeaders.subject, "headers.subject"),
      date: optionalInputString(explicitHeaders.date, "headers.date"),
      messageId: optionalInputString(explicitHeaders.messageId, "headers.messageId"),
    };
  }

  const payload = optionalInputObject(raw.payload, "payload");
  return gmailHeaderMap(payload?.headers);
}

function decodeBase64UrlText(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return Buffer.from(value, "base64url").toString("utf-8");
  } catch {
    return null;
  }
}

function gmailPartText(part: InboundSignalJsonObject): string | null {
  const mimeType = optionalInputString(part.mimeType, "payload.parts[].mimeType");
  const body = optionalInputObject(part.body, "payload.parts[].body");
  const bodyText = decodeBase64UrlText(
    optionalInputString(body?.data, "payload.parts[].body.data"),
  );
  if (mimeType === "text/plain" && clean(bodyText)) return bodyText;

  const parts = optionalInputArray(part.parts, "payload.parts[].parts");
  for (const [index, rawPart] of (parts ?? []).entries()) {
    const nested = optionalInputObject(rawPart, `payload.parts[].parts[${index}]`);
    if (!nested) continue;
    const text = gmailPartText(nested);
    if (clean(text)) return text;
  }
  return null;
}

function gmailText(raw: InboundSignalJsonObject): string {
  const explicitText = optionalInputString(raw.text, "text");
  if (explicitText !== undefined) return explicitText;

  const payload = optionalInputObject(raw.payload, "payload");
  const body = optionalInputObject(payload?.body, "payload.body");
  const bodyText = decodeBase64UrlText(
    optionalInputString(body?.data, "payload.body.data"),
  );
  const cleanBodyText = clean(bodyText);
  if (cleanBodyText) return cleanBodyText;

  const parts = optionalInputArray(payload?.parts, "payload.parts");
  for (const [index, rawPart] of (parts ?? []).entries()) {
    const part = optionalInputObject(rawPart, `payload.parts[${index}]`);
    if (!part) continue;
    const text = gmailPartText(part);
    const cleanText = clean(text);
    if (cleanText) return cleanText;
  }

  return optionalInputString(raw.snippet, "snippet") ?? "";
}

function calendarActorInput(
  value: InboundSignalJsonValue | undefined,
  label: string,
): GoogleWorkspaceCalendarActor | undefined {
  const raw = optionalInputObject(value, label);
  if (!raw) return undefined;
  return {
    email: optionalInputString(raw.email, `${label}.email`),
    displayName: optionalInputString(raw.displayName, `${label}.displayName`),
    self: optionalInputBoolean(raw.self, `${label}.self`),
  };
}

function calendarDateTimeInput(
  value: InboundSignalJsonValue | undefined,
  label: string,
): GoogleWorkspaceCalendarDateTime | undefined {
  const raw = optionalInputObject(value, label);
  if (!raw) return undefined;
  return {
    date: optionalInputString(raw.date, `${label}.date`),
    dateTime: optionalInputString(raw.dateTime, `${label}.dateTime`),
    timeZone: optionalInputString(raw.timeZone, `${label}.timeZone`),
  };
}

function calendarAttendeeInput(
  raw: InboundSignalJsonObject,
  label: string,
): GoogleWorkspaceCalendarAttendee {
  return {
    email: optionalInputString(raw.email, `${label}.email`),
    displayName: optionalInputString(raw.displayName, `${label}.displayName`),
    self: optionalInputBoolean(raw.self, `${label}.self`),
    responseStatus: optionalInputString(raw.responseStatus, `${label}.responseStatus`),
  };
}

function matchesConfiguredIdentity(
  email: string,
  identities: readonly string[] | undefined,
): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  return (identities ?? []).some((identity) => {
    const normalizedIdentity = identity.trim().toLowerCase();
    if (normalizedIdentity.length === 0) return false;
    if (normalizedIdentity.startsWith("@")) {
      return normalizedEmail.endsWith(normalizedIdentity);
    }
    return normalizedEmail === normalizedIdentity;
  });
}

function trustForIdentity(args: {
  email: string | null;
  kind: "sender" | "organizer";
  blocked: readonly string[] | undefined;
  trusted: readonly string[] | undefined;
  blockedConfigName: string;
  trustedConfigName: string;
}): TrustAssessment {
  if (!args.email) {
    return {
      trust: "untrusted",
      trustReason: `${args.kind} email is missing from the Google Workspace signal`,
    };
  }
  if (matchesConfiguredIdentity(args.email, args.blocked)) {
    return {
      trust: "blocked",
      trustReason: `${args.kind} '${args.email}' matched google-workspace ${args.blockedConfigName}`,
    };
  }
  if (matchesConfiguredIdentity(args.email, args.trusted)) {
    return {
      trust: "trusted",
      trustReason: `${args.kind} '${args.email}' matched google-workspace ${args.trustedConfigName}`,
    };
  }
  return {
    trust: "untrusted",
    trustReason: `${args.kind} '${args.email}' did not match google-workspace ${args.trustedConfigName}`,
  };
}

function timestampFromHeader(value: string | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function timestampFromMillis(value: string | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function timestampOrFallback(value: string | undefined, fallback: string): string {
  const parsed = timestampFromHeader(value);
  return parsed ?? fallback;
}

function gmailSourceUrl(
  message: GoogleWorkspaceGmailMessage,
  context: GoogleWorkspaceInboundSignalContext,
): string {
  if (isNonEmptyString(message.webLink)) return message.webLink;
  return `https://mail.google.com/mail/u/${encodeURIComponent(
    context.accountId,
  )}/#all/${encodeURIComponent(message.id)}`;
}

function gmailBodyText(message: GoogleWorkspaceGmailMessage): string {
  const lines = [
    `Subject: ${clean(message.headers.subject) ?? "(no subject)"}`,
    `From: ${clean(message.headers.from) ?? "(unknown sender)"}`,
    `To: ${clean(message.headers.to) ?? "(unknown recipient)"}`,
  ];
  const cc = clean(message.headers.cc);
  if (cc) lines.push(`Cc: ${cc}`);
  const snippet = clean(message.snippet);
  if (snippet) lines.push(`Snippet: ${snippet}`);
  const body = clean(message.text);
  if (body) lines.push("", body);
  return lines.join("\n");
}

function calendarDateTimeJson(
  value: GoogleWorkspaceCalendarDateTime | undefined,
): InboundSignalJsonObject | null {
  if (!value) return null;
  return {
    date: nullableString(value.date),
    dateTime: nullableString(value.dateTime),
    timeZone: nullableString(value.timeZone),
  };
}

function calendarActorJson(
  value: GoogleWorkspaceCalendarActor | undefined,
): InboundSignalJsonObject | null {
  if (!value) return null;
  return {
    email: nullableString(value.email),
    displayName: nullableString(value.displayName),
    self: nullableBoolean(value.self),
  };
}

function calendarAttendeeJson(
  attendee: GoogleWorkspaceCalendarAttendee,
): InboundSignalJsonObject {
  return {
    email: nullableString(attendee.email),
    displayName: nullableString(attendee.displayName),
    self: nullableBoolean(attendee.self),
    responseStatus: nullableString(attendee.responseStatus),
  };
}

function calendarActorIdentity(change: GoogleWorkspaceCalendarEventChange): {
  email: string | null;
  displayName: string;
} {
  const actor = change.organizer ?? change.creator;
  const email = clean(actor?.email)?.toLowerCase() ?? null;
  const displayName =
    clean(actor?.displayName) ??
    email ??
    "unidentified Google Calendar organizer";
  return { email, displayName };
}

function calendarAction(change: GoogleWorkspaceCalendarEventChange): string {
  return change.status === "cancelled"
    ? "google.calendar.event.cancelled"
    : "google.calendar.event.changed";
}

export function googleWorkspaceGmailMessageFromInboundRequest(
  raw: InboundSignalJsonObject,
): GoogleWorkspaceInboundInputResult<GoogleWorkspaceGmailMessage> {
  try {
    const message = inputEnvelope(raw, "message");
    return {
      ok: true,
      value: {
        id: requireInputString(message.id, "id"),
        threadId: requireInputString(message.threadId, "threadId"),
        historyId: optionalInputString(message.historyId, "historyId"),
        labelIds: optionalInputStringArray(message.labelIds, "labelIds"),
        snippet: optionalInputString(message.snippet, "snippet"),
        internalDate: optionalInputString(message.internalDate, "internalDate"),
        webLink: optionalInputString(message.webLink, "webLink"),
        headers: gmailHeaders(message),
        text: gmailText(message),
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function googleWorkspaceCalendarEventChangeFromInboundRequest(
  raw: InboundSignalJsonObject,
  defaultCalendarId: string,
): GoogleWorkspaceInboundInputResult<GoogleWorkspaceCalendarEventChange> {
  try {
    const event = inputEnvelope(raw, "event");
    const attendees = optionalInputArray(event.attendees, "attendees") ?? [];
    return {
      ok: true,
      value: {
        id: requireInputString(event.id, "id"),
        calendarId:
          optionalInputString(event.calendarId, "calendarId") ?? defaultCalendarId,
        status: requireInputString(event.status, "status"),
        summary: optionalInputString(event.summary, "summary"),
        description: optionalInputString(event.description, "description"),
        location: optionalInputString(event.location, "location"),
        htmlLink: optionalInputString(event.htmlLink, "htmlLink"),
        iCalUID: optionalInputString(event.iCalUID, "iCalUID"),
        recurringEventId: optionalInputString(
          event.recurringEventId,
          "recurringEventId",
        ),
        created: optionalInputString(event.created, "created"),
        updated: optionalInputString(event.updated, "updated"),
        organizer: calendarActorInput(event.organizer, "organizer"),
        creator: calendarActorInput(event.creator, "creator"),
        start: calendarDateTimeInput(event.start, "start"),
        end: calendarDateTimeInput(event.end, "end"),
        attendees: attendees.map((rawAttendee, index) => {
          const attendee = optionalInputObject(rawAttendee, `attendees[${index}]`);
          if (!attendee) throw new Error(`attendees[${index}] must be an object`);
          return calendarAttendeeInput(attendee, `attendees[${index}]`);
        }),
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function gmailMessageToInboundSignal(
  message: GoogleWorkspaceGmailMessage,
  context: GoogleWorkspaceInboundSignalContext,
): InboundSignalValidationResult {
  const sender = parseMailbox(message.headers.from);
  const trust = trustForIdentity({
    email: sender.email,
    kind: "sender",
    blocked: context.blockedSenders,
    trusted: context.trustedSenders,
    blockedConfigName: "inbound.blockedSenders",
    trustedConfigName: "inbound.trustedSenders",
  });
  const occurredAt =
    timestampFromHeader(message.headers.date) ??
    timestampFromMillis(message.internalDate) ??
    context.receivedAt;

  return validateInboundSignalPayload({
    projectId: context.projectId,
    provider: "google-workspace",
    channel: "gmail.message",
    accountId: `google:gmail:${context.accountId}`,
    sourceId: `google:gmail:${context.accountId}:message:${message.id}`,
    sourceUrl: gmailSourceUrl(message, context),
    externalId: `gmail:${message.id}`,
    occurredAt,
    receivedAt: context.receivedAt,
    actor: {
      id: sender.email
        ? `google:gmail:${sender.email}`
        : `google:gmail:unidentified-sender:${message.id}`,
      displayName:
        sender.displayName ??
        sender.email ??
        "unidentified Gmail sender",
      trust: trust.trust,
      trustReason: trust.trustReason,
    },
    body: {
      kind: "message",
      format: "plain",
      text: gmailBodyText(message),
    },
  });
}

export function calendarEventChangeToInboundSignal(
  change: GoogleWorkspaceCalendarEventChange,
  context: GoogleWorkspaceInboundSignalContext,
): InboundSignalValidationResult {
  const actor = calendarActorIdentity(change);
  const trust = trustForIdentity({
    email: actor.email,
    kind: "organizer",
    blocked: context.blockedOrganizers,
    trusted: context.trustedOrganizers,
    blockedConfigName: "inbound.blockedOrganizers",
    trustedConfigName: "inbound.trustedOrganizers",
  });
  const sourceUrl =
    clean(change.htmlLink) ??
    `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(change.id)}`;

  return validateInboundSignalPayload({
    projectId: context.projectId,
    provider: "google-workspace",
    channel: "calendar.event",
    accountId: `google:calendar:${context.accountId}`,
    sourceId: `google:calendar:${context.accountId}:${change.calendarId}:event:${change.id}`,
    sourceUrl,
    externalId: `google-calendar:${change.calendarId}:${change.id}`,
    occurredAt: timestampOrFallback(change.updated ?? change.created, context.receivedAt),
    receivedAt: context.receivedAt,
    actor: {
      id: actor.email
        ? `google:calendar:${actor.email}`
        : `google:calendar:unidentified-organizer:${change.id}`,
      displayName: actor.displayName,
      trust: trust.trust,
      trustReason: trust.trustReason,
    },
    body: {
      kind: "action",
      action: calendarAction(change),
      label: `${change.status} calendar event: ${clean(change.summary) ?? "(no title)"}`,
      data: {
        eventId: change.id,
        calendarId: change.calendarId,
        status: change.status,
        summary: nullableString(change.summary),
        description: nullableString(change.description),
        location: nullableString(change.location),
        htmlLink: nullableString(sourceUrl),
        iCalUID: nullableString(change.iCalUID),
        recurringEventId: nullableString(change.recurringEventId),
        created: nullableString(change.created),
        updated: nullableString(change.updated),
        organizer: calendarActorJson(change.organizer),
        creator: calendarActorJson(change.creator),
        start: calendarDateTimeJson(change.start),
        end: calendarDateTimeJson(change.end),
        attendees: (change.attendees ?? []).map(calendarAttendeeJson),
      },
    },
  });
}

export function emitGoogleWorkspaceInboundSignal(
  events: Pick<ModuleContext["events"], "emit">,
  signal: InboundSignalValidationResult,
): GoogleWorkspaceInboundEmitResult {
  if (!signal.ok) return { emitted: false, error: signal.error };
  events.emit(inboundSignalReceived, signal.payload);
  return { emitted: true, payload: signal.payload };
}
