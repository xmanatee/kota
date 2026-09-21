---
status: open
priority: p1
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
