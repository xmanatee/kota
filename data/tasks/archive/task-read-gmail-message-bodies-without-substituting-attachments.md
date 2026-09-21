---
status: done
---
# Read Gmail message bodies without substituting attachments or unlabeled snippets

## Problem and evidence

Explorer research on September 21, 2026 found a reproducible gap in
`gmail_get_message`, which advertises full message content. At revision
`b5a76072f7d5f084525fc4bf8fe76b4d3f530df2`, a synthetic message with a
`multipart/alternative` body nested inside `multipart/mixed` returns only its
snippet. Adding a sibling text attachment makes the tool return that attachment
as the message body instead. The actual body says delivery moved to Thursday;
the attachment says the old delivery is Tuesday. Neither result signals the
missing body. This is a production-tool observation with controlled HTTP input,
not evidence of a wrong model answer or a live mailbox incident.

Google's [Message reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages),
read online September 21, defines recursive child MIME parts, attachment
filenames and snippets as short excerpts. Its
[MessagePartBody reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments)
also allows body bytes to be supplied separately through an attachment ID.
This distinction is about storage: an attachment ID alone does not establish
that a part is a user-visible file attachment.

Run `2026-09-21T05-58-13-672Z-explorer-9qi5ik` retains
`artifacts/gmail-body-probe.mjs` and `artifacts/gmail-body-transcript.json`.
The probe invokes the production reader and HTTP adapter with synthetic
responses and a dummy token. Direct plain text succeeds; nested body text is
lost; a sibling text attachment is substituted; a separately stored body
falls back to an unlabeled snippet. Requests, inputs, outputs, timestamp and
source hash are retained. No real account, credentials, model or daemon was used.

## Outcome and acceptance

Users asking KOTA to read an email receive the available message body, with
attachments and unavailable content clearly distinguished.

- Retrieve inline plain-text body content through supported nested multipart
  containers. Preserve ordinary direct-body behavior and avoid duplicating
  equivalent alternative representations.
- Do not silently substitute a named or explicitly attached text file for the
  message body. Keep any attachment information distinguishable from body text.
- When body content cannot be read, including separately stored or unsupported
  content, clearly identify the limitation and any snippet fallback. Fetching
  separately stored bodies may be supported within existing HTTP limits;
  arbitrary attachment downloads and a new HTML renderer are not required.
- Treat malformed message structure and traversal/output limits honestly;
  they must not produce apparent complete success or unbounded traversal.
- Verify through the real tool with controlled responses for direct and nested
  bodies, a misleading sibling attachment, and unavailable body content.
  Retain the tool transcript showing the returned text and limitation messages.
  Live Gmail access is not a prerequisite for this deterministic adapter repair.

Keep ownership in `src/modules/google-workspace/` and its existing verification.
The archived module creation, Google Workspace tests, credential-cache repair,
inbound-signal adapters and calendar pagination task cover adjacent behavior,
not this message-body selection failure. No active task or inbox capture owns
this outcome. Builders choose the implementation and proportionate additional
cases; no new mail client, orchestration layer or evaluation runner is prescribed.

## Completion

Implemented in the Google Workspace reader on September 21, 2026. Inline
plain text is selected through bounded mixed/alternative MIME traversal;
alternative bodies are not duplicated and file attachments are excluded.
Unavailable, malformed, separately stored, unsupported and limited content is
explicitly labeled, including any excerpt fallback. Separately stored bytes
are intentionally not fetched; HTML and other MIME containers are reported as
unsupported rather than rendered or mistaken for complete body text.

Validation: all 103 Google Workspace owner tests and `pnpm check:fast` passed.
The owner tests exercise body selection, attachment exclusion, malformed input,
empty/Unicode bodies, unavailable bytes, and traversal/decoding/output limits.
Run `2026-09-21T06-35-20-703Z-builder-kfy5g8` retains
`artifacts/gmail-body-probe.mjs` and `artifacts/gmail-body-transcript.json`:
six controlled-response calls through the production reader and Google HTTP
adapter, with exact inputs, requests, rendered outputs and source hashes.
The transcript confirms direct/nested body retrieval, misleading attachment
exclusion, and labeled separately stored, HTML-only and malformed limitations.
No live mailbox or model was used; this is deterministic adapter evidence.
