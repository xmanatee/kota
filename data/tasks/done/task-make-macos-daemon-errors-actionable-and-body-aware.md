---
id: task-make-macos-daemon-errors-actionable-and-body-aware
title: Make macOS daemon errors actionable and body-aware
status: done
priority: p1
area: client
summary: Teach the macOS DaemonClient and views to decode daemon error payloads and present actionable provider-unavailable or HTTP diagnostics instead of generic Swift LocalizedError text such as KotaMenuBar.DaemonClientError error 0.
created_at: 2026-04-28T22:35:23.844Z
updated_at: 2026-04-29T02:13:25.253Z
---

## Problem

The macOS `DaemonClientError` only carries `notConnected`, `httpError(Int)`,
and `decodingError(Error)`. Most view loaders store `error.localizedDescription`.
For Swift enum errors that do not conform to `LocalizedError`, this produces
generic strings such as:

`The operation couldn't be completed. (KotaMenuBar.DaemonClientError error 0.)`

That hides the daemon's real JSON error body and makes provider/configuration
problems look like mysterious app failures.

## Desired Outcome

macOS daemon errors should be actionable:

- HTTP errors preserve status code and decoded daemon error/message/reason when
  the body is JSON.
- `DaemonClientError` conforms to `LocalizedError` with operator-facing
  descriptions.
- Views show concise, specific messages for offline daemon, unauthorized token,
  provider unavailable, semantic unavailable, decoding drift, and unexpected
  HTTP failures.
- Retry buttons remain available where retry is meaningful.

## Constraints

- Keep strict decoding for successful typed payloads; do not relax success
  contracts just to improve error display.
- Preserve existing typed `ok:false` success-response arms such as
  `semantic_unavailable`; do not convert them all into thrown errors.
- Avoid duplicating error formatting in every view. Prefer one `DaemonClient`
  helper and one small UI presentation helper/pattern.
- Add tests around both `LocalizedError` text and decoded HTTP body behavior.
- Do not require daemon API changes unless a missing error shape blocks
  actionable display.

## Done When

- `clients/macos/Sources/KotaMenuBar/DaemonClient.swift` decodes structured
  error bodies for non-2xx responses where present.
- `DaemonClientError` has stable, tested localized descriptions.
- Existing Knowledge/Memory/History/Tasks/Recall/Answer/Capture/Retract view
  errors render useful messages rather than enum fallback text.
- Tests cover generic HTTP, JSON error body, unauthorized/offline, and decoding
  drift cases.
- No existing DaemonClient contract tests regress.

## Source / Intent

2026-04-28 owner screenshot showed repeated red text:
`The operation couldn't be completed. (KotaMenuBar.DaemonClientError error 0.)`
while the daemon had actual provider initialization errors. This made the menu
bar feel broken and unactionable even when the backend failure was diagnosable.

## Initiative

Operator diagnostics: thin clients should explain what the daemon knows, not
hide it behind platform-default error strings.

## Acceptance Evidence

- Swift test output for structured error decoding and localized descriptions.
- A screenshot or rendered-output artifact showing a provider-unavailable or
  HTTP error message that is specific and actionable.
- A short before/after note in the run artifact naming the old generic error
  and the new displayed text.
