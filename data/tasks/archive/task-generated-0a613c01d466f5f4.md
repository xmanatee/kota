---
status: done
---
# Share Gmail body interpretation across reading and inbound automation

## Problem

gmailMessageResult applies bounded MIME selection, attachment exclusion and explicit availability reporting, while inbound-signal.ts independently implements decodeBase64UrlText, gmailPartText and gmailText. The webhook accepts the same message but can emit attachment text instead of its body, silently discard mixed-body segments, or promote a snippet into body text. The shared dispatcher preserves this misleading content in workflow input.

Investigation: Changed-source investigation found divergent Gmail body interpretation across two maintained consumers. A five-case synthetic probe exercised the production reader, contributed webhook handler, EventBus and inbound dispatcher. The reader correctly returns Thursday delivery text while the webhook substitutes a Tuesday attachment and passes that text into the workflow enqueue payload. The webhook also substitutes snippets for unavailable or explicitly empty bodies and drops later mixed-body segments. The completed reader repair addresses its declared tool outcome; the archived inbound-adapter task establishes the second consumer but does not resolve this divergence. No active task or inbox overlap was found. Consolidating MIME interpretation within Google Workspace is justified by observed consumer differences. No live mailbox incident, model error or delivery-issue correlation was established. Previously settled scanner observations were not reassessed. Repository files were unchanged.

Evidence:
- git:d2d531b004c6c4b00c30f41740d4b96a35ab203d
- docs/STANDARDS.md
- docs/ARCHITECTURE.md
- src/modules/google-workspace/AGENTS.md
- src/modules/google-workspace/gmail-message.ts
- src/modules/google-workspace/gmail.ts
- src/modules/google-workspace/gmail.test.ts
- src/modules/google-workspace/inbound-signal.ts
- src/modules/google-workspace/inbound-signal.test.ts
- src/modules/google-workspace/index.ts
- src/modules/google-workspace/index.test.ts
- src/modules/inbound-signals/routing-dispatch.ts
- src/modules/inbound-signals/routing-payloads.ts
- data/tasks/archive/task-read-gmail-message-bodies-without-substituting-attachments.md
- data/tasks/archive/task-add-gmail-and-calendar-inbound-signal-adapters.md
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t06-46-06-913z-archite-4f97e54c3bf134c871d35255aa87c64351df473e41cd9498932c68e73a2bb0df/agent/gmail-consumer-probe.mjs
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t06-46-06-913z-archite-4f97e54c3bf134c871d35255aa87c64351df473e41cd9498932c68e73a2bb0df/agent/gmail-consumer-transcript.json

## Desired Outcome

Reading a Gmail message and receiving it through the configured webhook use the same body-selection and availability semantics. Inbound workflows receive available body text with explicit limitations and distinguishable excerpts. A single module-owned decoder is expected to prevent further divergence; preservation and maintenance benefits remain to be verified.

This is an unverified expectation, not a measured improvement.

Maintained consumers:
- gmail_get_message through makeGmailGetMessage
- POST /api/webhooks/google-workspace/gmail through googleWorkspaceGmailMessageFromInboundRequest and gmailMessageToInboundSignal
- Configured inbound workflows receiving signal.body.text

Alternatives considered:
- Leave both implementations unchanged: retains the reproduced content substitution and omission.
- Patch the inbound reader independently: repairs current examples but preserves two owners for identical MIME decisions.
- Separate typed body decoding from gmailMessageResult rendering and reuse it in inbound normalization: preferred because both maintained consumers interpret the same Google message payload.
- Introduce a core MIME framework: unnecessary for these two consumers within one provider module.

Migration and retirement: Extract or reshape the existing bounded Gmail interpretation into a precise module-local result that distinguishes available, partial and unavailable content, including explicit empty bodies. Migrate the tool renderer and Google-shaped inbound requests to that owner. Preserve normalized inbound text input and its explicit precedence, along with source identity, timestamps, sender trust and routing. Retire the independent inbound MIME traversal, permissive byte decoder and unlabeled snippet-to-body fallback. Link this follow-up to the archived reader and inbound-adapter tasks without reopening their already delivered contracts.

Common behavior: Bounded interpretation of Google Gmail MIME payloads, including plain-text selection, attachment exclusion, mixed/alternative handling, byte validation and content availability.
Stable variation point: Tool-result rendering versus inbound-signal rendering; normalized inbound text and source/actor metadata remain inbound-specific.
Canonical owner: src/modules/google-workspace, evolving the existing gmail-message.ts interpretation

## Constraints

Preserve the maintained consumers' domain-specific behavior.

## How We Will Know

Exercise the production tool and contributed webhook with equivalent direct, nested, attachment-first, mixed-segment, empty, separately stored, unsupported and malformed messages. Show correct body content or explicit limitations at the emitted signal and workflow enqueue boundary. Preserve normalized text input, sender trust, scope/account identity, bounded traversal/output and existing tool effects. Retain a controlled transcript with source provenance; no live mailbox or model is required. Keep parser cases at their owning layer and focused propagation checks at consumer boundaries. Run affected owner tests and pnpm check:fast.

Show both maintained consumers using one typed Gmail body decoder, with the old inbound traversal and fallback removed. Keep tool and signal presentation separate, and consolidate redundant decoding tests while retaining distinct routing, metadata and trust checks. Demonstrate that changing attachment or availability policy requires one implementation change rather than coordinated reader repairs.

Record actual migrated callers, retired paths and the simpler result in this task's completion evidence. The gardener follows this task; expected benefits alone do not establish success.

## Completion evidence

`decodeGmailBody` in `src/modules/google-workspace/gmail-message.ts` now owns
bounded MIME selection and returns a discriminated available/partial/unavailable
result with text, limitations and excluded attachment count. The tool renderer
`gmailMessageResult` (called by `makeGmailGetMessage`) and the Google-shaped
request path in `googleWorkspaceGmailMessageFromInboundRequest` both consume it.
`gmailMessageToInboundSignal` renders that result into `signal.body.text` with
explicit availability and excerpt labels. Normalized request `text` retains
precedence, including empty and whitespace-only strings; sender trust, source,
account, timestamps and dispatcher routing remain with their existing owners.

Removed `decodeBase64UrlText`, `gmailPartText`, `gmailText` and the unlabeled
snippet-to-body fallback from inbound normalization. MIME policy now changes
at one implementation used by both readers; tool and signal presentation remain
separate. Parser cases moved from tool-runner tests to `gmail-message.test.ts`.
The previous normalized-message dispatch scenario and its synthetic decision
workflow were replaced by two root integration cases covering the contributed
webhook, real EventBus and production dispatcher enqueue boundary. Metadata,
trust, normalized-input and tool error/effect checks remain with their owners.

Verification in builder run `2026-09-21T06-52-00-977Z-builder-hvpeps`:

- `pnpm test:owner src/modules/google-workspace src/modules/inbound-signals`:
  117 tests passed across nine files. These exercise decoder rejection and
  bounds, tool rendering/errors, normalized input precedence, metadata/trust,
  and dispatcher behavior.
- `pnpm test:integration src/gmail-inbound-body.integration.test.ts`: two tests
  passed, proving partial and unavailable content survives the webhook, event
  and workflow enqueue composition without attachment substitution.
- `pnpm check:fast`: passed production/test typing, lint, task validation,
  generated client bindings and admission of 90 bundled modules.
- Controlled production-consumer probe: 17 cases passed for direct, nested,
  attachment-first, mixed-segment, empty, separately stored, unsupported,
  malformed, partial, traversal/output/decoding limits and normalized input.
  The retained `agent/gmail-consumer-probe.mjs` and
  `artifacts/gmail-consumer-transcript.json` contain the reproducible stimulus,
  source hashes, rendered tool and signal results, and equality checks against
  the workflow enqueue payload. Large rendered outputs are explicitly sampled
  with their full length and hash. `artifacts/check-fast.log` retains the static
  gate output.

These are controlled local observations, not live-mailbox or model outcomes.
The probe substitutes external HTTP and enqueue ports; it does not claim actual
workflow execution or deployment. Future maintenance cost or incident reduction
has not been measured.

This completes the shared-consumer follow-up to
[the reader repair](task-read-gmail-message-bodies-without-substituting-attachments.md)
and [the inbound adapters](task-add-gmail-and-calendar-inbound-signal-adapters.md);
their completed contracts were not reopened.
