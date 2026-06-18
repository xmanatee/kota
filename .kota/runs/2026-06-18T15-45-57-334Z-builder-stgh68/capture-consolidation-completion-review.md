# Capture Consolidation Completion Review

Task: `task-fan-out-consolidation-capture`

## Verdict

The capture surface-family consolidation task is complete. The previous
headless review named one actionable drift: web production API calls used typed
casts instead of the shared conformance decoders. That follow-up,
`task-fold-conformance-decoders-into-web-client-runtime-`, is now in `done/`,
and current `clients/web/src/api/client.ts` routes `api.capture` through
`apiDecoded("/api/capture", parseCaptureResult, ...)`.

No additional follow-up task is needed from this completion review.

## Evidence

- Rendered visual evidence exists at `.kota/runs/capture-consolidation-screens-20260615T160041Z/` for telegram/chat, mobile, macOS, and web. Its README ties the files back to `.kota/runs/client-visual-evidence-20260615T160041Z/`.
- Module seam validation: `capture-module-tests.txt` records 6 capture test files and 53 passing tests.
- Web validation: `web-capture-tests.txt` records the conformance fixture, decoder-boundary, and CapturePanel tests with 86 passing tests.
- Mobile validation: `mobile-capture-tests.txt` records CaptureScreen and contract fixture tests with 83 passing tests.
- Apple validation: `apple-capture-tests.txt` records CaptureView and ContractFixtureTests with 74 passing XCTest tests. The command used `swift test --disable-sandbox` because SwiftPM's nested `sandbox-exec` is not permitted inside this session sandbox.

## Done-When Review

1. Information architecture is represented by the shipped web sidebar `CapturePanel`, mobile `CaptureScreen`, macOS menu-bar `ComposeSection` capture mode, Telegram `/capture` plus `/capture-to-*`, Slack `/capture` plus `/capture-to-*`, and CLI `kota capture` surface recorded in the task's headless review.
2. Cross-client contract consistency is pinned by the shared conformance fixture and decoders for all capture success and failure arms, with web, mobile, and Apple test coverage refreshed in this run.
3. The previously duplicated-runtime-decoder drift is retired by the done web decoder follow-up; no new duplicate decoder or error-renderer drift was found.
4. Provider/readiness degradation is covered by `ambiguous`, `no_contributors`, and `contributor_failed` arms in module, chat, web, mobile, and Apple tests.
5. Rendered evidence for visual surfaces exists in the June 15 artifact directory, and this run adds fresh test transcripts for contract and rendering paths.
6. No stale capture affordance superseded by this fan-out was found in the current grep/read pass.
7. `src/modules/capture/AGENTS.md` describes the shipped shared route/render/conformance boundaries and no longer contains stale "fan-out lands later" language.
8. Accepted critic-warning debt is represented by the now-done web decoder follow-up; no remaining warning requires a new task.
