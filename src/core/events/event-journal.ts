import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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
    const events = this.readAll();
    if (events.length === 0) return 1;
    return Math.max(...events.map((event) => event.sequence)) + 1;
  }

  private readEventsAfter(after: string | undefined): EventEnvelope[] {
    const events = this.readAll();
    if (after === undefined) return events;
    const cursorIndex = events.findIndex((event) => event.id === after);
    return cursorIndex >= 0 ? events.slice(cursorIndex + 1) : [];
  }

  private readAll(): EventEnvelope[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, "utf-8");
    const events: EventEnvelope[] = [];
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!.trim();
      if (line.length === 0) continue;
      let parsed: EventEnvelope;
      try {
        parsed = JSON.parse(line) as EventEnvelope;
      } catch (error) {
        throw new Error(
          `${this.filePath}:${index + 1}: malformed event journal entry: ${String(error)}`,
        );
      }
      assertEventEnvelope(parsed, this.filePath, index + 1);
      events.push(parsed);
    }
    return events;
  }
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
