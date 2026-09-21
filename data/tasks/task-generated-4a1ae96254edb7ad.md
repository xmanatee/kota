---
status: open
priority: p2
---
# Share bounded Google Workspace listing with honest completeness reporting

## Problem

Gmail and Drive listings discard continuation evidence while Calendar separately implements bounded retrieval. Drive omits nextPageToken and incompleteSearch from its fields mask and ignores them when supplied. Gmail silently removes failed detail reads. Users cannot reliably distinguish exhausted results, bounded partial results and unavailable details. The reproduced gap concerns tool output, not a measured assistant mistake.

Investigation: Changed-source investigation followed Calendar listing into the maintained Gmail and Drive consumers. A controlled production-tool probe showed Drive returning 'No files found.' despite continuation or incomplete-search metadata, Gmail discarding continuation, and a failed Gmail detail request becoming an unqualified '0 message(s)' result. Drive also excludes completeness metadata from its requested fields. Calendar already implements bounded continuation and explicit retrieval outcomes; its control scenario correctly retrieved a later event. These consumers justify a shared module-local retrieval mechanism with service-specific interpretation. Active-task and related inbox searches found no overlapping outcome. Archived Calendar completeness, token ownership and Gmail body-decoding tasks address different contracts and need no reopening. Previously settled scanner observations were not reassessed. No causal delivery-issue correlation, live-provider incident or model-answer failure was established. Probe inputs, requests, outputs and source hashes are retained; existing test sources were inspected but suites were not rerun.

Evidence:
- git:2ac4a38155f8eae97f3881a4a462cc38a5942e85
- docs/STANDARDS.md
- docs/VERIFICATION.md
- docs/ARCHITECTURE.md
- src/core/modules/bundled-module-discovery.ts
- src/modules/google-workspace/AGENTS.md
- src/modules/google-workspace/index.ts
- src/modules/google-workspace/auth.ts
- src/modules/google-workspace/calendar.ts
- src/modules/google-workspace/calendar.test.ts
- src/modules/google-workspace/gmail.ts
- src/modules/google-workspace/gmail.test.ts
- src/modules/google-workspace/drive.ts
- src/modules/google-workspace/drive.test.ts
- data/tasks/archive/task-preserve-calendar-list-completeness.md
- data/tasks/archive/task-preserve-calendar-scheduling-meaning.md
- data/tasks/archive/task-generated-cce4c7558197c624.md
- data/tasks/archive/task-generated-0a613c01d466f5f4.md
- data/tasks/archive/task-google-workspace-module.md
- data/tasks/archive/task-split-google-workspace-module.md
- data/tasks/archive/task-add-google-workspace-module-tests.md
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t08-59-07-271z-archite-da6a86cdadf8729e6a86ad48bf62f3ec8d1781db9dfad11a5efb54df006edf92/agent/list-completeness-probe.mjs
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t08-59-07-271z-archite-da6a86cdadf8729e6a86ad48bf62f3ec8d1781db9dfad11a5efb54df006edf92/agent/list-completeness-probe.json
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t08-59-07-271z-archite-da6a86cdadf8729e6a86ad48bf62f3ec8d1781db9dfad11a5efb54df006edf92/agent/investigation.md

## Desired Outcome

Gmail, Drive and Calendar lists use one module-owned bounded retrieval mechanism and expose complete, partial or unavailable outcomes without losing retrieved items. Gmail detail failures and Drive search limitations remain explicit. Expected benefits are more reliable results and fewer independently maintained traversal decisions; these remain unverified until implementation.

This is an unverified expectation, not a measured improvement.

Maintained consumers:
- gmail_list_messages through makeGmailListMessages
- drive_list_files through makeDriveListFiles
- calendar_list_events through makeCalendarListEvents

Alternatives considered:
- Leave implementations unchanged: retains the reproduced loss of completeness and failure information.
- Repair Gmail and Drive independently: feasible, but repeats traversal and termination behavior already maintained for Calendar.
- Harvest Calendar's bounded traversal into a Google Workspace-local owner with typed service adapters: preferred.
- Create a core pagination SDK: unsupported by the inspected consumers, which share one module owner.

Migration and retirement: Move Calendar's common accumulation, continuation, bounds and termination decisions into a module-local mechanism and migrate all three listing tools. Keep endpoint construction, provider schemas and rendering service-specific. Request and decode Drive continuation/search metadata; retain Gmail detail failures as explicit limitations instead of filtering them into apparent success. Preserve current account selection, query semantics, result caps and Calendar scheduling meaning. Remove the replaced Calendar loop and obsolete single-page success paths. Move generic traversal cases to their owning layer while retaining distinct service checks. Link the follow-up to the completed Calendar completeness task without reopening its delivered outcome.

Common behavior: Accumulate typed page items within explicit limits, follow continuation, detect nontermination, retain retrieved results on failure and distinguish exhaustion from incomplete retrieval.
Stable variation point: Service request construction and decoding, result caps, rendering, Gmail detail hydration and Drive incomplete-search semantics.
Canonical owner: src/modules/google-workspace, harvesting the existing Calendar retrieval mechanism while continuing to use auth.ts and the shared outbound HTTP port.

## Constraints

Preserve the maintained consumers' domain-specific behavior.

## How We Will Know

Exercise real tool runners with controlled responses for terminal empty results, empty/short intermediate pages, result and page limits, cyclic tokens, continuation failures and invalid payloads, preserving earlier results and selected account/query parameters. Verify Drive requests completeness fields and reports incomplete searches; Gmail retains successful details while disclosing failed ones. Preserve Calendar attendance, blocking, calendar selection and fixed time-window behavior, credential ownership and read effects. Retain requests and rendered transcripts. Run affected owner tests and pnpm check:fast; live accounts are unnecessary.

Show all three maintained lists consuming one bounded traversal/result owner, with the old Calendar traversal retired and service adapters limited to actual domain differences. Consolidate redundant traversal proofs while retaining provider decoding and rendering checks. Demonstrate that continuation and termination policy changes require one implementation change. Report the actual resulting structure without claiming measured maintenance savings.

Record actual migrated callers, retired paths and the simpler result in this task's completion evidence. The gardener follows this task; expected benefits alone do not establish success.
