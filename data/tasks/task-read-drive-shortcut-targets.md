---
status: open
priority: p2
---
# Read supported Drive files reached through shortcuts

## Problem and evidence

An agent can discover a Drive shortcut through `drive_list_files`, but passing
its ID to `drive_read_file` requests `alt=media` on the shortcut itself. The
reader requests only name and MIME type, so it never obtains the target ID.
The useful outcome is reading the referenced document without asking the user
to locate a second ID manually.

Google's [file overview](https://developers.google.com/workspace/drive/api/guides/about-files)
identifies shortcuts as metadata-only files that cannot be downloaded. Its
[shortcut guide](https://developers.google.com/workspace/drive/api/guides/shortcuts)
documents target identity, independently changing names, stale target MIME
hints, and broken references after deletion or loss of access. Its
[resource-key guide](https://developers.google.com/workspace/drive/api/guides/resource-keys)
describes `shortcutDetails.targetResourceKey` and the request header used for
link-shared targets. These first-party pages were read online September 21, 2026.

Explorer run `2026-09-21T13-23-49-754Z-explorer-zkgzmc` retains
`agent/drive-shortcut-probe.mjs` and `agent/drive-shortcut-transcript.json`.
The probe invokes production listing and reading tools with controlled HTTP
responses: a direct document selects export and returns text; a listed shortcut
selects raw download of the shortcut ID and returns the supplied error.
The synthetic 403 is not an observed Google response. The request selection is
observed KOTA behavior; no live account, model or daemon was exercised.

## Outcome and acceptance

- Reading a listed Drive shortcut to an accessible, already-supported text,
  Docs or Sheets target returns that target's content. Preserve the shortcut
  and resolved file identity in the result so differently named files are
  understandable. Use current target metadata when deciding how to read it.
- Honor provider-supplied target resource keys where required, through the
  existing authenticated HTTP owner. Keep reads within the configured account
  and Google API boundary; never change sharing permissions or expose keys in
  ordinary output and diagnostics.
- Missing or inaccessible targets, malformed references, folders and unsupported
  target types produce an explicit unavailable/unsupported result, with no
  invented content or claim that access was granted. Resolution terminates on
  malformed cyclic references.
- Preserve direct-file reads, character truncation and the existing first-sheet
  CSV coverage notice. Verify the production list-to-read journey with a
  controlled provider port, including success, stale shortcut metadata,
  resource-key propagation and unavailable target outcomes. Retain requests
  and rendered tool results; live Google credentials are not required for
  this adapter contract.

Keep ownership in `src/modules/google-workspace/` and its existing verification.
Archived `task-generated-4a1ae96254edb7ad` owns listing completeness;
`task-disclose-drive-spreadsheet-export-coverage` owns CSV coverage. Neither
resolves shortcut targets. Active tasks and inbox were checked for overlap.
This work does not add a Drive index, browser fallback, permission-management
surface or a new connector. Builders own the implementation and proportionate
verification.
