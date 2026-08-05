import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import { join } from "node:path";
import type { EvidencePrunedReference } from "#core/evidence/policy.js";
import type { BusEnvelope, EventBus } from "./event-bus.js";
import { assertEventEnvelope } from "./event-journal-codec.js";
import { buildEventEnvelope } from "./event-journal-envelope.js";
import {
  eventEnvelopeToBusEnvelope,
  toEventJournalClientProjection,
} from "./event-journal-projection.js";
import { eventPrunedReference } from "./event-journal-pruned-reference.js";
import {
  envelopeAvailableForQuery,
  envelopeMatchesQuery,
  hasMetadataReferenceAfterExpiry,
} from "./event-journal-query.js";
import type {
  EventEnvelope,
  EventJournalClientProjection,
  EventJournalOptions,
  EventJournalQuery,
  EventJournalRetentionPolicy,
} from "./event-journal-types.js";

export { redactedPayloadForClient } from "./event-journal-payload.js";
export { eventEnvelopeToBusEnvelope } from "./event-journal-projection.js";
export type * from "./event-journal-types.js";

const DEFAULT_JOURNAL_FILE = "journal.jsonl";
const REVERSE_READ_CHUNK_BYTES = 64 * 1024;

function reverseQueryLimit(query: EventJournalQuery): number | undefined {
  if (query.id !== undefined) return 1;
  if (query.limit !== undefined) return query.limit;
  return query.sinceMs === undefined ? undefined : Number.MAX_SAFE_INTEGER;
}

function reverseQueryStop(
  sinceMs: number | undefined,
): ((event: EventEnvelope) => boolean) | undefined {
  return sinceMs === undefined
    ? undefined
    : (event) => Date.parse(event.timestamps.journaledAt) <= sinceMs;
}

export class EventJournal {
  private readonly filePath: string;
  private readonly retention: EventJournalRetentionPolicy;
  private readonly now: () => Date;
  private readonly scopeLineage: (scopeId: string) => readonly string[];
  private nextSequence: number;

  constructor(dir: string, options: EventJournalOptions = {}) {
    this.filePath = join(dir, options.fileName ?? DEFAULT_JOURNAL_FILE);
    this.retention = options.retention ?? { kind: "retain" };
    this.now = options.now ?? (() => new Date());
    this.scopeLineage = options.scopeLineage ?? ((scopeId) => [scopeId]);
    mkdirSync(dir, { recursive: true });
    this.nextSequence = this.readNextSequence();
  }

  getPath(): string {
    return this.filePath;
  }

  appendFromBusEnvelope(envelope: BusEnvelope): EventEnvelope {
    const journaledAt = this.now();
    const sequence = this.nextSequence;
    const record = buildEventEnvelope(
      envelope,
      sequence,
      journaledAt,
      this.retention,
      this.scopeLineage,
    );
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, "utf-8");
    this.nextSequence = sequence + 1;
    return record;
  }

  appendEnvelope(envelope: EventEnvelope): EventEnvelope {
    appendFileSync(this.filePath, `${JSON.stringify(envelope)}\n`, "utf-8");
    this.nextSequence = Math.max(this.nextSequence, envelope.sequence + 1);
    return envelope;
  }

  query(query: EventJournalQuery = {}): EventEnvelope[] {
    const reverseLimit = reverseQueryLimit(query);
    if (query.after === undefined && reverseLimit !== undefined && reverseLimit > 0) {
      const nowMs = this.now().getTime();
      return this.readFromEnd(
        reverseLimit,
        (event) => envelopeAvailableForQuery(event, query, nowMs),
        reverseQueryStop(query.sinceMs),
      );
    }
    let events = this.readEventsAfter(query.after);
    const nowMs = this.now().getTime();
    events = events.filter((event) => envelopeAvailableForQuery(event, query, nowMs));
    if (query.limit !== undefined && query.limit > 0 && events.length > query.limit) {
      events = events.slice(events.length - query.limit);
    }
    return events;
  }

  queryPrunedReferences(query: EventJournalQuery = {}): EvidencePrunedReference[] {
    const nowMs = this.now().getTime();
    const reverseLimit = reverseQueryLimit(query);
    if (query.after === undefined && reverseLimit !== undefined && reverseLimit > 0) {
      return this.readFromEnd(
        reverseLimit,
        (event) =>
          hasMetadataReferenceAfterExpiry(event, nowMs) &&
          envelopeMatchesQuery(event, query),
        reverseQueryStop(query.sinceMs),
      ).map(eventPrunedReference);
    }
    const references = this.readEventsAfter(query.after)
      .filter((event) => hasMetadataReferenceAfterExpiry(event, nowMs))
      .filter((event) => envelopeMatchesQuery(event, query))
      .map(eventPrunedReference);
    if (query.limit !== undefined && query.limit > 0 && references.length > query.limit) {
      return references.slice(references.length - query.limit);
    }
    return references;
  }

  replay(
    query: EventJournalQuery,
    handle: (envelope: BusEnvelope) => void,
  ): EventEnvelope[] {
    const events = this.query(query);
    for (const event of events) {
      handle(eventEnvelopeToBusEnvelope(event));
    }
    return events;
  }

  toClientProjection(envelope: EventEnvelope): EventJournalClientProjection {
    return toEventJournalClientProjection(envelope);
  }

  private readNextSequence(): number {
    const latest = this.readFromEnd(1, () => true).at(-1);
    return latest === undefined ? 1 : latest.sequence + 1;
  }

  private readEventsAfter(after: string | undefined): EventEnvelope[] {
    const events = this.readAll();
    if (after === undefined) return events;
    const cursorIndex = events.findIndex((event) => event.id === after);
    return cursorIndex >= 0 ? events.slice(cursorIndex + 1) : [];
  }

  private readFromEnd(
    limit: number,
    include: (event: EventEnvelope) => boolean,
    stop?: (event: EventEnvelope) => boolean,
  ): EventEnvelope[] {
    if (!existsSync(this.filePath)) return [];
    const descriptor = openSync(this.filePath, "r");
    try {
      let position = fstatSync(descriptor).size;
      let leadingLine = Buffer.alloc(0);
      const matches: EventEnvelope[] = [];

      while (position > 0 && matches.length < limit) {
        const length = Math.min(REVERSE_READ_CHUNK_BYTES, position);
        position -= length;
        const chunk = Buffer.allocUnsafe(length);
        const bytesRead = readSync(descriptor, chunk, 0, length, position);
        if (bytesRead !== length) {
          throw new Error(`${this.filePath}: changed while reading recent events`);
        }
        const data = Buffer.concat([chunk, leadingLine]);
        let lineEnd = data.length;
        for (let index = data.length - 1; index >= 0; index -= 1) {
          if (data[index] !== 0x0a) continue;
          const line = data.subarray(index + 1, lineEnd).toString("utf8").trim();
          lineEnd = index;
          if (line.length === 0) continue;
          const event = parseEventJournalLine(
            line,
            this.filePath,
            `byte ${position + index + 1}`,
          );
          if (stop?.(event)) return matches.reverse();
          if (include(event)) matches.push(event);
          if (matches.length === limit) break;
        }
        leadingLine = data.subarray(0, lineEnd);
      }

      if (position === 0 && matches.length < limit && leadingLine.length > 0) {
        const line = leadingLine.toString("utf8").trim();
        if (line.length > 0) {
          const event = parseEventJournalLine(line, this.filePath, "byte 0");
          if (stop?.(event)) return matches.reverse();
          if (include(event)) matches.push(event);
        }
      }
      return matches.reverse();
    } finally {
      closeSync(descriptor);
    }
  }

  private readAll(): EventEnvelope[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, "utf-8");
    const events: EventEnvelope[] = [];
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!.trim();
      if (line.length === 0) continue;
      events.push(parseEventJournalLine(line, this.filePath, index + 1));
    }
    return events;
  }
}

function parseEventJournalLine(
  line: string,
  path: string,
  location: number | string,
): EventEnvelope {
  let parsed: EventEnvelope;
  try {
    parsed = JSON.parse(line) as EventEnvelope;
  } catch (error) {
    throw new Error(`${path}:${location}: malformed event journal entry: ${String(error)}`);
  }
  assertEventEnvelope(parsed, path, location);
  return parsed;
}

export function installEventJournal(
  bus: EventBus,
  journal: EventJournal,
): () => void {
  return bus.addEmitMiddleware((envelope, next) => {
    const durable = journal.appendFromBusEnvelope(envelope);
    envelope.eventId = durable.id;
    next();
  });
}
