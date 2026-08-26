import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EventSchemaReference } from "#core/events/event-bus.js";
import { ensureDir } from "./run-io.js";

export const EMITTED_EVENTS_LOG_FILENAME = "emitted-events.jsonl";

type EmittedEventEvidence = Readonly<{
  publicationId?: string;
  event: string;
  schemaRef: EventSchemaReference | null;
  payload: Readonly<Record<string, unknown>>;
  emittedAt: string;
}>;

/** Project an observable event without making the evidence log an authority. */
export function recordEmittedEventEvidence(
  runDirPath: string,
  evidence: EmittedEventEvidence,
): void {
  ensureDir(runDirPath);
  const path = join(runDirPath, EMITTED_EVENTS_LOG_FILENAME);
  if (evidence.publicationId !== undefined && existsSync(path)) {
    const alreadyRecorded = readFileSync(path, "utf8")
      .split("\n")
      .some((line) => {
        if (!line.trim()) return false;
        try {
          const entry = JSON.parse(line) as { publicationId?: unknown };
          return entry.publicationId === evidence.publicationId;
        } catch {
          return false;
        }
      });
    if (alreadyRecorded) return;
  }
  appendFileSync(path, `${JSON.stringify(evidence)}\n`, "utf8");
}
