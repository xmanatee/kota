# Window Envelope Protocol v1

The protocol consumes one envelope at a time:

```json
{
  "schemaVersion": 1,
  "window": { "start": 100, "end": 200 },
  "events": []
}
```

Normative clauses:

- **WEP-1 Envelope shape.** A conforming envelope MUST have
  `schemaVersion: 1`, an integer `window.start`, an integer `window.end`, and
  `window.start < window.end`. Each event MUST be an object with a non-empty
  string `id`, an integer `timestamp`, and an object `payload`.
- **WEP-2 Window membership.** Events are in scope when
  `window.start <= event.timestamp < window.end`. The start bound is inclusive;
  the end bound is exclusive. Out-of-window events MUST be rejected with
  reason `outside-window`.
- **WEP-3 Canonical id.** Accepted event ids are matched case-insensitively
  after trimming surrounding ASCII whitespace. The emitted `canonicalId` MUST
  be the lowercase normalized id.
- **WEP-4 Duplicate resolution.** When multiple in-window events share a
  canonical id, the accepted output MUST keep only the event with the greatest
  integer `sequence`. Missing `sequence` is treated as `0`. A tie keeps the
  earliest in-window event.
- **WEP-5 Required extensions.** An event MAY declare `requires` as an array of
  extension ids. Supported extension ids are `basic` and `priority`. An event
  that requires any other extension MUST be rejected with reason
  `unsupported-extension`.
