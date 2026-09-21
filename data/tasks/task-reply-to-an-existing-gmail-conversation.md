---
status: open
priority: p2
---

# Reply to an existing Gmail conversation with its identity intact

## Outcome

A user can select an existing Gmail message and send an approved reply in its
conversation through KOTA's Google Workspace tools. The reply preserves the
selected parent, intended recipients and conversation identity; the user can
review what will be sent and receives an honest delivery result.

## Evidence and sources

Explorer run `2026-09-21T12-53-26-614Z-explorer-ovpkqp` read Google's
[threading guide](https://developers.google.com/workspace/gmail/api/guides/threads)
online on September 21, 2026. It requires the target `threadId`, compliant
`References` and `In-Reply-To` headers, and matching subject headers to add a
message to a thread. Reusing a subject alone does not satisfy that contract.
Google's preview
[create_draft tool](https://developers.google.com/workspace/gmail/api/reference/mcp/tools_list/create_draft)
also accepts an original message ID for a reply. This is a useful input-design
reference, not a requirement to adopt Google's preview MCP service.

KOTA's `src/modules/google-workspace/gmail.ts` exposes only `to`, `subject`,
`body` and optional `cc` on `gmail_send`. A controlled production-tool probe
read a synthetic message with a thread ID and RFC message headers, then sent
ordinary supported inputs with `Re: Planning`. The captured request contained
only `raw`, with no target thread or reply headers. `gmail_get_message` also
omitted the supplied threading metadata from its rendered result. The send
result printed the response's thread ID without any selected parent to compare.
This establishes a missing tool capability, not an observed live misthreaded
email or model mistake.

Reproducer and rendered request/result evidence are retained as
`gmail-reply-probe.mjs` and `gmail-reply-probe.json` under this run's agent
directory. The probe replaces only the HTTP port, supplies a synthetic token,
and makes no external requests. Its response thread ID is synthetic and proves
nothing about Gmail's actual grouping behavior.

Related archived work delivered the original Workspace tool set, account-bound
token ownership, bounded listing and MIME body reading. None provides an
explicit reply operation. Active relative-date retrieval research concerns
read selection; no overlapping reply outcome was found in tasks or inbox.

## Acceptance

- The supported tool journey can bind a reply to a selected message in the
  configured account and produce the provider's documented threading fields
  from trustworthy retrieved metadata. Do not rely on the model inventing RFC
  message IDs or embedding headers in free text.
- Approval identifies the selected conversation and the actual recipients and
  content. Preserve the existing external-write approval boundary; reply intent
  does not imply reply-all or permission to expand recipients.
- Missing or unusable parent metadata fails clearly before sending. Reject
  header-breaking input. A provider failure or inconsistent response must not
  be described as a confirmed reply in the selected conversation.
- Retain a representative read/select/approve/send result transcript and
  focused production-boundary proof for correct parent binding, unrelated
  messages with the same subject, and unavailable parent data. Ordinary new
  messages must remain usable. Distinguish controlled provider-contract proof
  from any separately authorized live-mailbox observation.

Keep the capability with the existing Google Workspace module, authentication,
HTTP and approval owners. Builders choose the tool shape and verification;
this outcome does not require a new mail client, draft subsystem or MCP migration.
