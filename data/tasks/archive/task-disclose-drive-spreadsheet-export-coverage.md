---
status: done
---
# Disclose first-sheet-only coverage when reading Google spreadsheets

## Problem and evidence

Google's [Drive export format reference](https://developers.google.com/workspace/drive/api/guides/ref-export-formats),
read online September 21, 2026, specifies that CSV and TSV exports contain only
the first sheet. Its [download/export guide](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
distinguishes Workspace format exports from raw file downloads.

KOTA's `drive_read_file` exports Google spreadsheets as CSV, then returns the
file name, original spreadsheet MIME type and text. A production-tool probe on
September 21 confirmed that a successful short CSV response carries no
first-sheet coverage disclosure. Lowering `maxChars` adds only a character
truncation marker; that separate limit does not communicate sheet coverage.
The tool description also omits its spreadsheet export behavior.

Run `2026-09-21T11-44-19-428Z-explorer-jcbulg` retains
`agent/drive-export-probe.mjs` and `agent/drive-export-probe.json` with
synthetic inputs, requested URLs, returned tool text, observation time and
the source hash. It invokes the real tool factory and Google adapter using a
controlled HTTP port and dummy token. No Google account, actual workbook,
model or daemon was used. This establishes missing coverage information at
the tool boundary, not a measured wrong assistant answer or a live export.

A user asking for a summary across spreadsheet tabs needs to know that the
returned text cannot establish what the other sheets contain.

## Outcome and acceptance

- Callers of the existing Drive reader can identify spreadsheet results as a
  CSV export limited to the first sheet, even when all returned characters fit.
  Tool discovery describes this supported behavior accurately.
- Distinguish export coverage from local character truncation. A shortened
  first-sheet export communicates both limits. Do not infer the workbook's
  sheet count, sheet name, or whether other sheets are empty from this response.
- Preserve useful returned data, ordinary text/Google Docs behavior, and honest
  provider-error handling. This outcome does not require all-sheet retrieval,
  new credentials, a spreadsheet editor, or an additional confirmation flow.
- Exercise the production reader with controlled provider responses for an
  untruncated spreadsheet export, a truncated export and ordinary supported
  text. Retain the returned tool transcript and proportionate owner checks;
  external account setup is not a prerequisite for this boundary correction.

The owner is `src/modules/google-workspace/drive.ts`. The active
[workbook-edit investigation](../task-investigate-workbook-edit-verification.md)
owns local XLSX editing, recalculation and delivery observations; its CSV
source note does not cover this read-result contract. The archived Google
Workspace module task established basic tool availability. Neither is a
predecessor or duplicate of this disclosure outcome.

## Completion

The Google Workspace Drive reader now labels successful spreadsheet reads as
CSV exports of the first sheet only. The notice stays outside `maxChars`, so
shortened exports retain both coverage and truncation information. Discovery
also describes the export behavior. No sheet count, name or other-sheet content
is inferred; ordinary text, Google Docs and provider errors retain their behavior.

The focused Drive owner suite passed all 23 cases, including empty, exact-limit,
untruncated and truncated exports, ordinary text/Docs and failed exports.
Run `2026-09-21T12-15-51-166Z-builder-uxfi0y` retains
`artifacts/drive-read-probe.mjs` and `artifacts/drive-read-transcript.json` with
production reader results, controlled provider inputs, URLs and a source hash.
The transcript covers both spreadsheet limits, text/Docs and provider failure.
This is tool-boundary evidence using a dummy token, not a live Google export
or evidence of a downstream model answer.
