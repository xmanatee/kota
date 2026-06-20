import type {
  CalendarAvailabilityOutput,
  CalendarBusyWindow,
  CalendarCandidateResult,
  CalendarToolPayload,
  OpportunityCandidate,
  OpportunityScreeningOutput,
  RejectedSignal,
} from "./matching-types.js";

function windowsOverlap(
  candidate: OpportunityCandidate,
  busy: CalendarBusyWindow,
): boolean {
  return Date.parse(candidate.startsAt) < Date.parse(busy.end) &&
    Date.parse(candidate.endsAt) > Date.parse(busy.start);
}

export function checkCalendarAvailability(
  screened: OpportunityScreeningOutput,
  busyWindows: readonly CalendarBusyWindow[],
): CalendarAvailabilityOutput {
  const available: CalendarCandidateResult[] = [];
  const rejected: RejectedSignal[] = [...screened.rejected];
  for (const candidate of screened.candidates) {
    const conflicts = busyWindows.filter((busy) => windowsOverlap(candidate, busy));
    if (conflicts.length > 0) {
      rejected.push({
        externalId: candidate.source.externalId,
        sourceId: candidate.source.sourceId,
        reason: "calendar-conflict",
        detail: `candidate overlaps ${conflicts.length} busy calendar window(s)`,
      });
      continue;
    }
    available.push({ ...candidate, available: true, conflicts });
  }

  return {
    busyWindows: [...busyWindows],
    checkedCount: screened.candidates.length,
    available: available.sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt) || b.confidence - a.confidence
    ),
    rejected,
  };
}

export function parseCalendarToolBusyWindows(content: string): CalendarBusyWindow[] {
  const parsed = JSON.parse(content) as CalendarToolPayload;
  return [...(parsed.busyWindows ?? parsed.events ?? [])];
}
