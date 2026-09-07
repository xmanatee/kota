---
status: done
---

# Prune web, mobile, and Apple test duplication

## Scope / Starting Points

Inventory `clients/web`, `clients/mobile`, and `clients/apple` suites for domain matrices, resource lifecycle, routing, accessibility, navigation, rendering, trust, confirmation, transport, fixtures, and snapshots.

## Required Changes

- Retain only platform navigation, accessibility, interaction, trust, confirmation, domain-specific rendering, and genuine transport boundary behavior.
- Delete domain lifecycle copies, shared-state matrices, incidental snapshots, and exhaustive local/daemon or screen permutations.
- Keep a bounded set of real client journeys, each tied to a distinct composition failure.

## Must Not Complete While

Any screen/scenario is unclassified, shared owner behavior remains repeated, or a journey uses internal mocks that eliminate the boundary it claims to prove.

## Done When

The inventory has zero unresolved rows and every retained scenario names a web, mobile, Apple, accessibility, navigation, rendering, or trust failure unique to that surface.

## Acceptance Evidence

Provide the surface/scenario/disposition matrix and before/after executable-test and authored-support LOC per client runtime.

## Initiative

Child of `task-prune-operator-and-channel-test-duplication`.

## Implementation and verification record

Inventoried all 122 admitted executable scenarios, six authored support files,
client screens, generated fixture copies, and snapshot surfaces. Every scenario
has a retain, narrow/consolidate, or delete disposition and a platform-specific
failure or replacement proof; zero rows remain unresolved. The full surface/scenario/disposition matrix and per-file LOC accounting
are included below so review requires only this task record and repository state.

| Client runtime | Test files before → after | Executable-test LOC before → after | Authored-support LOC before → after |
| --- | ---: | ---: | ---: |
| Web | 11 → 9 | 1,510 → 1,223 | 127 → 127 |
| Mobile / Android | 9 → 9 | 945 → 794 | 160 → 160 |
| Apple / shared Swift | 5 → 3 | 1,431 → 1,189 | 32 → 32 |

Counts are physical source lines including comments and blanks. Test-file LOC
includes inline helpers; authored support counts separate setup/utilities/fixtures.
Generated JSON and bindings, manifests, lockfiles and build scripts are excluded.
Before-file counts and the complete classification appear below.

Removed Apple empty/unavailable/retry matrices, copied inventory sorting,
constructor-only menu-bar pseudo-render evidence and generated capture-union
catalog tests. Removed duplicated web voice/action API tests and mobile UI
transport/confirmation checks already covered by client composition. Replaced
exhaustive mobile fixture traversals with bounded native navigation examples;
kept native request arbitration, source trust, rendering, accessibility,
interaction, confirmation, and handwritten transport behavior.

The retained browser and Android confirmed-action journeys now reject any
pre-confirmation request. Browser dashboard-header and synthesized-Blob oracles
moved into the retained interaction journeys. Single-scope browser visibility now
uses a loaded registry so its absence assertion cannot pass before identity loads.
Shared state transitions remain owned by the typed resource owners and exhaustive
presentation switches. Native cancellation/source/polling checks retain distinct
AppState request and connection authority failures.

Validation: generated client/UI binding freshness and task validation passed;
eight pure resource-projection, native navigation and field-parsing checks passed
using the available Vitest runner; all retained Swift tests typechecked against
the compiled production KotaShared module and SwiftPM's resource accessor. All
18 retained TypeScript/TSX test files parsed without syntax errors. Final diff
inspection verified deletions, oracle transfers, package target cleanup and local
instructions. No production client behavior changed.

Limitations: full React DOM/Jest suites could not start because client dependencies
were absent and package downloads were denied. SwiftPM failed during build
planning under the managed sandbox; direct Swift compilation/typechecking passed.
No full client runtime, iOS simulator, screenshot or hardware pass is claimed.
Retained journeys keep production providers/navigation/transport and control only
network/device ports; component doubles are not presented as production journeys.

The normal task command `pnpm kota task move
task-prune-web-mobile-apple-test-duplication done` was attempted after validation
and rejected with `Repo-task mutation requires the active workflow runtime`.
The CLI process does not receive the runtime's opaque writer-workspace authority.
Repair attempts 1 and 2 retried the same normal command and received the same
rejection (exit 1). The independent critic accepted the implementation with
warnings for execution limits and pending task closure.
The implementation and inventory evidence are ready for review, but the task
remains open pending the runtime-authorized lifecycle transition; no direct
status/archive bypass was used.

## Surface/scenario/disposition matrix

Consumer: human operators of web, Android, macOS and iOS. Every row names its production platform owner and the distinct observable failure, or the authoritative replacement proof. Stimulus and oracle are also explicit in the retained test bodies. Cadence remains web `pnpm test`, mobile `pnpm test -- --runInBand`, Apple `swift test`; no tests are added to server portfolios.

All baseline test scenarios and authored support files are classified below; generated fixture copies are explicitly excluded from authored LOC. AppPlatformOwnership has two parameterized cases. C means narrowed/consolidated, R retained, D deleted. There are zero unresolved rows.

| Surface / suite | Scenario | Disposition and distinct failure / replacement |
| --- | --- | --- |
| `clients/web/src/test-setup.ts` | Authored support | Retain browser storage port and DOM cleanup; no domain decisions. |
| `clients/web/src/hooks/use-daemon-events.test.tsx` | derives graph refresh and live-log subscriptions from the bundle | R Browser EventSource delivery must invalidate the active Query cache and append log entries; hook and QueryClient remain real. |
| `clients/web/src/lib/scope-context-navigation.test.tsx` | parses #s/<scopeId>/<sub> hashes | R Browser hash parsing must preserve a scope-local subroute, including unscoped entry hashes. |
| `clients/web/src/lib/scope-context-navigation.test.tsx` | hides the selector when the daemon hosts exactly one directory scope | C Loaded single-directory navigation must hide the selector; use a supplied loaded registry so absence cannot pass during an unfinished identity fetch. |
| `clients/web/src/lib/utils.test.ts` | formats milliseconds | R Browser duration display must retain subsecond precision. |
| `clients/web/src/lib/utils.test.ts` | formats seconds | R Browser duration display must scale seconds correctly. |
| `clients/web/src/lib/utils.test.ts` | formats minutes | R Browser duration display must format the minute remainder. |
| `clients/web/src/lib/utils.test.ts` | returns empty for 0 | R Browser duration display must omit an absent duration. |
| `clients/web/src/lib/utils.test.ts` | formats seconds | R Browser uptime display must preserve a seconds-only value. |
| `clients/web/src/lib/utils.test.ts` | formats hours and minutes | R Browser uptime display must combine hours and minutes. |
| `clients/web/src/lib/utils.test.ts` | escapes special chars | R Browser HTML escaping must prevent markup injection. |
| `clients/web/src/lib/utils.test.ts` | renders code blocks | R Browser chat markdown must render fenced code. |
| `clients/web/src/lib/utils.test.ts` | renders bold text | R Browser chat markdown must render emphasis. |
| `clients/web/src/lib/utils.test.ts` | renders inline code | R Browser chat markdown must distinguish inline code. |
| `clients/web/src/lib/utils.test.ts` | renders safe links | R Browser chat markdown must preserve safe clickable links. |
| `clients/web/src/lib/utils.test.ts` | rejects javascript links | R Browser chat markdown must reject executable javascript URLs. |
| `clients/web/src/lib/scope-context.test-utils.tsx` | Authored support | Retain typed loaded-context provider for component tests; scope composition journey uses the production provider. |
| `clients/web/src/lib/scope-context.test.tsx` | renders the selector, scopes fetches to the active scope, and switches without leaking rows | R Browser scope selector, hash, query keys and HTTP scope must compose without showing the previous scope rows; real context, query factories, Sidebar and HTTP adapter. |
| `clients/web/src/api/client-ui.test.ts` | strictly loads the selected scope's shared UI bundle | D Duplicate scoped bundle load; real ScopeProvider/Query/Sidebar journey already observes scoped HTTP and displayed rows. Generated decoder structure is checked by binding freshness. |
| `clients/web/src/api/client-ui.test.ts` | executes the graph-bound action with its canonical scope | D Duplicate action serialization; real rendered confirmed/unconfirmed actions already traverse the HTTP adapter. Move the dashboard trust-header oracle into that confirmed journey. |
| `clients/web/src/api/resource-state.test.ts` | exposes an initially paused offline query as retryable offline state | R Browser Query adapter must map a paused, initially pending query to offline rather than an endless spinner. |
| `clients/web/src/api/resource-state.test.ts` | preserves an empty presentation while cached data refetches | R Browser Query adapter must preserve empty presentation during a background refetch; this tests the Query projection, not a per-screen shared-state matrix. |
| `clients/web/src/api/voice.test.ts` | voiceTranscribe POSTs base64 audio and parses a successful response | D Duplicate Blob-to-base64 request already observed from rendered VoiceControls capture. |
| `clients/web/src/api/voice.test.ts` | voiceTranscribe surfaces the daemon's typed failure code on 503 | D Duplicate STT failure already propagated through VoiceControls onError. |
| `clients/web/src/api/voice.test.ts` | voiceSynthesize decodes returned audio bytes into a Blob | D Duplicate synthesis conversion; retain the Blob MIME/size oracle in VoiceControls playback. |
| `clients/web/src/api/voice.test.ts` | voiceSynthesize surfaces tts-format-unsupported on 400 | D Extra voice error-code permutation; one typed STT failure proves browser error propagation through the shared voice error parser. |
| `clients/web/src/components/sidebar/Sidebar.test.tsx` | derives intents and surfaces only from the daemon bundle | R Browser navigation must expose accessible intent groups and graph-supplied buttons. |
| `clients/web/src/components/sidebar/Sidebar.test.tsx` | selects graph-declared surfaces | R Browser Sidebar activation must send the stable surface id. |
| `clients/web/src/components/sidebar/Sidebar.test.tsx` | renders loading and unavailable states without a fallback catalog | R Browser Sidebar must present an accessible failure and connect its Retry button; supplied states test presentation, not lifecycle transitions. |
| `clients/web/src/components/chat/VoiceControls.test.tsx` | captures, uploads, and forwards a transcript on the happy path | R Browser MediaRecorder capture must become an HTTP upload and transcript callback. |
| `clients/web/src/components/chat/VoiceControls.test.tsx` | surfaces stt-unavailable from the daemon as a typed onError | R Browser failed capture request must reach onError and never submit a transcript. |
| `clients/web/src/components/chat/VoiceControls.test.tsx` | synthesizes the latest assistant text and plays it back | C Browser synthesized Blob must reach Audio playback and be revoked at completion; preserve the deleted API suite MIME/size oracle here. |
| `clients/web/src/components/shared-ui/SharedUiSurface.test.tsx` | renders the operator surface's status, live source, and navigation | R Browser status/source rendering must include a real daemon-route anchor. |
| `clients/web/src/components/shared-ui/SharedUiSurface.test.tsx` | filters any declared table by search and exact column values | R Browser accessible table controls must combine search and exact column filters correctly. |
| `clients/web/src/components/shared-ui/SharedUiSurface.interactions.test.tsx` | navigates surface links and navigation nodes through the shared callback | R Browser graph navigation buttons must dispatch a stable surface target. |
| `clients/web/src/components/shared-ui/SharedUiSurface.interactions.test.tsx` | resumes graph-declared sessions through the browser shell callback | R Browser session links must invoke the shell session callback, not graph navigation. |
| `clients/web/src/components/shared-ui/SharedUiSurface.interactions.test.tsx` | renders multiline graph fields as text areas | R Browser multiline fields must expose an actual textarea. |
| `clients/web/src/components/shared-ui/SharedUiSurface.interactions.test.tsx` | renders entries delivered to a graph-declared live log stream | R Browser log rendering must display incoming entries and event source. |
| `clients/web/src/components/shared-ui/SharedUiSurface.interactions.test.tsx` | executes a graph-declared read action without confirmation | R Browser read action with no fields must submit without a confirmation interaction. |
| `clients/web/src/components/shared-ui/SharedUiSurface.interactions.test.tsx` | submits typed parameters after inline confirmation and renders success | C Browser typed form must show confirmation before any HTTP request and send confirmed=true plus dashboard trust header; retain accessible success feedback. |
| `clients/web/src/components/shared-ui/SharedUiSurface.interactions.test.tsx` | submits an explicit daemon-host path for Add Scope | R Browser path input must submit the explicit daemon-host folder through confirmation; the browser cannot substitute a native picker path. |
| `clients/web/src/components/shared-ui/SharedUiSurface.interactions.test.tsx` | submits an unconfirmed graph-declared form | R Browser unconfirmed select form must propagate the edited option and render success. |
| `clients/web/src/components/shared-ui/SharedUiSurface.interactions.test.tsx` | disables unavailable actions and explains readiness | R Browser unavailable action must be disabled and explain readiness. |
| `clients/web/src/components/shared-ui/SharedUiSurface.test-utils.tsx` | Authored support | Retain generated semantic input and production QueryClient/render wrapper. |
| `clients/mobile/jest.setup.js` | Authored support | Retain secure-storage and notification device-port doubles. |
| `clients/mobile/src/__tests__/AppPlatformOwnership.test.tsx` | iOS platform entry | R iOS entry must show native Apple guidance without mounting daemon or device services. |
| `clients/mobile/src/__tests__/AppPlatformOwnership.test.tsx` | web platform entry | R Browser entry must show unsupported-platform guidance without mounting daemon or device services. |
| `clients/mobile/src/__tests__/routeNotificationResponse.test.ts` | forwards stable surface and action ids to live graph navigation | R Native notification response must forward stable surface and action ids to the router. |
| `clients/mobile/src/__tests__/routeNotificationResponse.test.ts` | accepts a surface-only target | R Native notification response must allow a surface-only destination. |
| `clients/mobile/src/__tests__/routeNotificationResponse.test.ts` | fails closed for malformed targets | R Untrusted native notification data must reject malformed navigation targets. |
| `clients/mobile/src/__tests__/SharedUiGraph.test.ts` | derives every intent tab and surface stack from ordered graph data | C Native tab and stack ordering: replace copied sorting algorithm/catalog traversal with three semantic surfaces and explicit expected order. |
| `clients/mobile/src/__tests__/SharedUiGraph.test.ts` | resolves stable surface and action deep links against the live bundle | C Native deep-link trust rejects missing surface/action targets; positive notification navigation is owned by the app journey, not every fixture action. |
| `clients/mobile/src/__tests__/SharedUiGraph.test.ts` | matches graph-declared refresh events and appends typed live logs | R Native event matching must reject another scope and map current events to the correct live stream. |
| `clients/mobile/src/__tests__/voiceClient.test.ts` | voiceTranscribe POSTs base64 audio and parses success | R Native Uint8Array capture must be base64 encoded by the mobile HTTP adapter. |
| `clients/mobile/src/__tests__/voiceClient.test.ts` | voiceTranscribe surfaces stt-unavailable on 503 | R Native voice adapter must normalize a transcription HTTP failure. |
| `clients/mobile/src/__tests__/voiceClient.test.ts` | voiceSynthesize decodes returned audio bytes | R Native voice adapter must decode synthesized audio into byte data (browser Blob conversion is a different implementation). |
| `clients/mobile/src/__tests__/voiceClient.test.ts` | voiceSynthesize surfaces tts-format-unsupported with supported list | R Native synthesis failure must retain the supported-format hint, a distinct mobile result field. |
| `clients/mobile/src/__tests__/SharedUiSurface.test.tsx` | renders the canonical composite surface with native components | C Native readiness labels, disabled controls and live log text remain; remove incidental test-id presence for every fixture node. |
| `clients/mobile/src/__tests__/SharedUiSurface.test.tsx` | renders every generated node arm contributed by the canonical fixture | D Exhaustive fixture-node traversal only checks test ids; generated unions and exhaustive renderer switches own arm completeness. |
| `clients/mobile/src/__tests__/SharedUiSurface.test.tsx` | covers component callbacks, live logs, and a confirmed typed action | C Native navigation, daemon-link and pull-to-refresh callbacks remain; confirmation with mocked DaemonContext is removed in favor of the real-provider app journey. |
| `clients/mobile/src/__tests__/daemonClient.test.ts` | push registration uses the authenticated transport | R Native push token registration must use the bearer-authenticated transport. |
| `clients/mobile/src/__tests__/daemonClient.test.ts` | session deletion treats an absent session as deleted | R Native session deletion must tolerate HTTP 404 at its handwritten adapter. |
| `clients/mobile/src/__tests__/daemonClient.test.ts` | session deletion surfaces other transport failures | R Native session deletion must propagate non-404 HTTP failures. |
| `clients/mobile/src/__tests__/daemonClient.test.ts` | session URLs encode external identifiers and cursors | R Native chat/SSE URLs must encode external identifiers/cursors; these handwritten URL helpers are not generated bindings. |
| `clients/mobile/src/__tests__/SharedUiProductionJourney.test.tsx` | navigates by stable ids, refreshes from SSE, and executes a confirmed action through production providers | C Real Android App, secure-store bootstrap, navigation, providers, resource owner and XHR transport must compose for notification navigation, SSE refresh and confirmed HTTP action; add pre-confirmation zero-request and confirmed flag oracles. |
| `clients/mobile/src/__tests__/SharedUiProductionJourney.test.tsx` | retries daemon-route failures through the authenticated native stack | R Real Android daemon-route screen must expose Retry and reload the authenticated document after network failure. |
| `clients/mobile/src/__tests__/SharedUiProductionJourney.test-fixture.ts` | Authored support | Retain HTTP responses, XHR byte delivery and notification input helpers; no provider/router/resource implementation is replaced. |
| `clients/mobile/src/__tests__/SharedUiActionParameters.test.ts` | derives defaults and typed structured values from the generated schema | R Native text-field values must produce typed arrays/objects and schema defaults. |
| `clients/mobile/src/__tests__/SharedUiActionParameters.test.ts` | rejects structured values whose JSON shape disagrees with the schema | R Native structured text input must reject array/object shape mismatch with field-specific feedback. |
| `clients/mobile/src/__tests__/SharedUiActionParameters.test.ts` | discovers the action through the same exhaustive graph traversal | D Positive action discovery duplicates the notification journey and graph resolver. |
| `clients/mobile/src/__tests__/SharedUiActionParameters.test.ts` | passes an explicit daemon-host path through the generated Add Scope field | C Native explicit host-path input must remain a string; reuse the existing action with a semantic path schema instead of copying another full action contract. |
| `clients/mobile/src/__tests__/daemonClient-ui.test.ts` | loads and strictly decodes the generated bundle for the active scope | D Duplicate scoped bundle request, already traversed by the real-provider app journey. |
| `clients/mobile/src/__tests__/daemonClient-ui.test.ts` | executes a graph action through the single shared endpoint | D Duplicate action serialization, already observed at the HTTP port in the confirmed app journey. |
| `clients/mobile/src/__tests__/daemonClient-ui.test.ts` | loads daemon-route links with the client bearer token | D Duplicate daemon-route bearer header, already observed by the retry journey. |
| `clients/mobile/src/__tests__/daemonClient-ui.test.ts` | rejects malformed daemon-route paths and non-JSON values | R Native handwritten daemon-route adapter must reject malformed path and non-JSON payloads. |
| `clients/mobile/src/__tests__/daemonClient-ui.test.ts` | rejects an unknown action result arm | R Native handwritten action-result decoder must reject an unknown result arm; it is not generated. |
| `clients/apple/Tests/KotaSharedTests/DaemonContractGeneratedTests.swift` | testCaptureWriteFailureForRepoTargetsDecodesGenericFailureVariant | D Capture task/inbox union catalog is generated from the daemon contract, has no Apple operator stimulus and belongs to generator/daemon contract proof. Binding freshness validates canonical projection. |
| `clients/apple/Tests/KotaSharedTests/ScopeFixtures.swift` | Authored support | Retain typed scope input builders; no lifecycle implementation. |
| `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | testNativeFolderPickerHandsAHostPathToSharedUiForms | R Apple picker delegation must hand a host path from PlatformAffordances to AppState. |
| `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | testInventoryUsesOnlyDaemonSurfaceOrderAndIntent | D Copied sorting/reduce implementation is not an independent oracle; bounded hierarchy navigation scenario remains. |
| `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | testInventoryPreservesSurfaceHierarchyAndChoosesRootEntry | R Apple navigation must choose a root entry and preserve nested surface indentation despite ordering. |
| `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | testSubscriptionIdentityIncludesConnectionAndScope | R Apple SSE subscription identity must change with connection or scope so a stale stream is not reused. |
| `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | testEventMatchingRejectsOtherScopesAndMapsCurrentScopeStreams | R Apple live event projection must reject another scope and route the current stream. |
| `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | testEventWatchReplaysAfterCursorAndPreservesEnvelopeIdentity | R Apple URLSession SSE must send the replay cursor and preserve wire envelope identity. |
| `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | testAppStateLoadsBundleExecutesActionAndDelegatesLinks | R Apple AppState, URLSession, generated bundle decoder and platform URL delegate must compose through an action result. |
| `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | testFailedExternalURLLaunchPreservesTheTransientFallback | R Apple failed external URL handoff must preserve its manual fallback payload. |
| `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | testSourceChangeRejectsDelayedSurfaceAndActionResponses | R Apple delayed scope-old response must not restore content or launch an external action after scope selection changes. |
| `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | testAppStateClassifiesEmptyAndUnavailableSurfaceResponses | D Empty/unavailable/retry resource matrix duplicates ResourceStateOwner transitions and exhaustive ResourceStateShell presentation. |
| `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | testDaemonSourceChangeDoesNotRetainThePreviousSurfaceOnFailure | R Apple changing daemon connection with the same scope must discard old content if replacement transport fails. |
| `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | testInvalidAndOfflineSourcesDisconnectBeforeResourceRetry | R Apple invalid remote configuration or absent local discovery must disconnect before Retry, preventing requests to a previous daemon. |
| `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | testSlashCommandResourceUsesSharedEmptyFailureAndRetryTransitions | D Slash-command empty/failure/retry matrix repeats the same ResourceStateOwner used by bundles. |
| `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | testSlashCommandRefreshCancellationRestoresPreviousAndNewestRequestWins | R Apple Task cancellation and same-source request races must honor request identity; ResourceStateOwner does not own async task arbitration. |
| `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | testDaemonPollingRefreshesSlashCommandsAcrossTransportLossAndReplacement | R Apple identity polling must clear stale commands on transport loss and reload the replacement daemon catalog; real AppState and URLSession remain. |
| `clients/apple/Tests/KotaSharedTests/DaemonClientErrorTests.swift` | testDecodeDaemonErrorBodyParsesErrorAndCode | R Apple handwritten HTTP error decoding must retain daemon text and code. |
| `clients/apple/Tests/KotaSharedTests/DaemonClientErrorTests.swift` | testDecodeDaemonErrorBodyParsesReason | R Apple reason-only error must produce a useful display summary. |
| `clients/apple/Tests/KotaSharedTests/DaemonClientErrorTests.swift` | testDecodeDaemonErrorBodyFallsBackToRawText | R Apple non-JSON HTTP failures must preserve raw diagnostic text. |
| `clients/apple/Tests/KotaSharedTests/DaemonClientErrorTests.swift` | testDecodeDaemonErrorBodyReturnsNilForEmptyBody | R Apple empty HTTP body must not create a meaningless error envelope. |
| `clients/apple/Tests/KotaSharedTests/DaemonClientErrorTests.swift` | testNotConnectedDescription | R Apple offline error must provide usable connection guidance. |
| `clients/apple/Tests/KotaSharedTests/DaemonClientErrorTests.swift` | testHTTPError401WithBodyMentionsToken | R Apple unauthorized error with body must retain daemon explanation. |
| `clients/apple/Tests/KotaSharedTests/DaemonClientErrorTests.swift` | testHTTPError401WithoutBodyExplainsToken | R Apple unauthorized error without body must explain token recovery. |
| `clients/apple/Tests/KotaSharedTests/DaemonClientErrorTests.swift` | testHTTPError503ProviderUnavailableIncludesCode | R Apple service-unavailable rendering must include the provider code. |
| `clients/apple/Tests/KotaSharedTests/DaemonClientErrorTests.swift` | testHTTPError404UsesEndpointWording | R Apple missing endpoint rendering must distinguish route failure. |
| `clients/apple/Tests/KotaSharedTests/DaemonClientErrorTests.swift` | testHTTPError500WithReasonOnly | R Apple generic server failure must retain a reason-only diagnostic. |
| `clients/apple/Tests/KotaSharedTests/DaemonClientErrorTests.swift` | testDecodingErrorPreservesUnderlyingDescription | R Apple decoding failure rendering must preserve mismatch details. |
| `clients/apple/Tests/KotaSharedTests/DaemonClientErrorTests.swift` | testPresenterUsesDaemonClientErrorLocalizedDescription | R Apple error presenter must select the domain LocalizedError text. |
| `clients/apple/Tests/KotaSharedTests/DaemonClientErrorTests.swift` | testPresenterPassesThroughGenericErrors | R Apple error presenter must preserve external LocalizedError text. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testNoScopeWhenSelectedDirIsNil | R Apple unconfigured local connection must explain scope selection. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testNoControlFileWhenScopeHasNoLock | R Apple local missing control file must identify the selected directory and recovery. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testUnreadableControlFile | R Apple unreadable local discovery must show warning severity. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testStaleControlFileFlagsPidGone | R Apple dead local PID must show stale-daemon recovery. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testFreshControlFileButIdentityProbeNeverRanIsUnreachable | R Apple live PID without identity proof must remain unreachable. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testFreshControlFileWithUnreachableProbe | D Additional unreachable-probe permutation repeats the same diagnostic with no distinct rendered or trust result. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testFreshControlFileWithTokenRejection | R Apple rejected local token must remain disconnected and show HTTP status. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testWrongScopeMismatchAfterIdentityProbe | R Apple identity from another directory must warn about both selected and actual scope. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testConnectedWhenIdentityMatchesSelectedScopeDir | R Apple matching local identity must render connected scope identity. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testRemoteInvalidURL | R Apple invalid remote URL must produce a configuration warning. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testRemoteEmptyStringClassifiesAsInvalid | D Empty remote URL is a second input for the same invalid-URL diagnostic. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testRemoteUnreachableWithoutProbe | R Apple remote unreachability must render error severity without local discovery assumptions. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testRemoteUnreachableWithTokenRejection | R Apple remote token rejection must render token-specific remote guidance. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testRemoteConnectedWithIdentity | R Apple remote connection must visibly identify its remote source. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testClassifyIdentityFailureMaps401To403ToTokenRejected | R Apple HTTP identity failures must classify 401/403 as token rejection. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testClassifyIdentityFailureMapsOtherErrorsToUnreachable | R Apple non-auth identity failures must remain unreachable, not authorized. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testClassifyDaemonControlFileMissing | R Apple local discovery must distinguish a missing file at the filesystem port. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testClassifyDaemonControlFileFresh | R Apple local discovery must decode port/PID and inspect process liveness. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testClassifyDaemonControlFileStale | R Apple local discovery must reject a dead PID. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testClassifyDaemonControlFileUnreadableJSON | R Apple local discovery must classify malformed JSON as unreadable. |
| `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | testBearerTokenValueIsNeverIncludedInDiagnosticRendering | D Vacuous redaction matrix: its synthetic token never enters any diagnostic input. Typed diagnostic shape excludes bearer tokens; no false redaction claim retained. |
| `clients/apple/Tests/KotaMenuBarTests/MenuBarRenderedTests.swift` | testMenuBarShellConstructsTheSharedRenderer | D View construction has no rendered or interaction oracle; compiling the shell and shared SwiftUI types owns construction. Remove the empty test target. |

### Screen and fixture inventory

| Runtime / surfaces | Disposition |
| --- | --- |
| Web App, Sidebar, ScopeSelector | Retain scope navigation/HTTP composition and accessible navigation controls; single-scope visibility is a component check, not a second journey. |
| Web shared surface, node/data/status/detail/metrics/progress/log/link/navigation rendering, table, action/forms | Retain meaningful DOM, filtering, session callbacks, readiness, explicit path and confirmation interactions; exhaustive union switches own structural completeness. No per-module approval/decision/workflow lifecycle matrices remain. |
| Web ChatArea, SlashCommandPalette, AutonomyModeControl, UI primitives | No separate baseline executable suites; strict component types and shared resource/presentation own structure. VoiceControls retains capture/failure/playback composition. No new product coverage is claimed. |
| Android App, intent/stack navigation, ResourceScreen, DaemonRouteScreen | Two production-provider journeys: notification/SSE/confirmation and authenticated document retry. Generic lifecycle remains in shared resource owner and native ResourceScreen. |
| Android shared surface/node/data/table/action/fields | Retain local navigation callbacks, readiness/log rendering and typed input parsing. Remove exhaustive node-id fixture traversal and duplicated mocked-context confirmation. |
| Android ChatDetailScreen and SettingsScreen | No separate baseline screen suites. Retain handwritten voice/push/session transport boundaries and secure-store bootstrapping in the App journey. Native hardware rendering is not claimed. |
| Apple MenuBarView, IOSRootView, SharedOperatorRootView, scope selector | Shared SwiftUI compiler proof plus native inventory/source/transport checks; remove constructor-only menu-bar suite and its target. No rendered screenshot test existed. |
| Apple shared surface/node/form/action, ChatView slash commands | Common ResourceStateOwner and exhaustive ResourceStateShell replace lifecycle matrices. Retain request cancellation, scope/connection trust and polling integration where AppState owns the async behavior. |
| Apple SettingsView, VoiceController, platform shells | No separate baseline rendered suites; retain diagnostic, picker and URL delegation checks. Swift module compilation checks shared types; iOS simulator/hardware behavior is not claimed. |
| All runtimes: generated UI behavior vectors / wire bindings | Generated copies excluded from authored LOC, unchanged; generation freshness is checked against canonical sources. Semantic vectors feed retained rendering examples without freezing their full catalog. |
| All runtimes: snapshots | No snapshot files or snapshot assertions in the admitted suites. Constructor-only Apple pseudo-render test and incidental mobile node-id assertions removed. |

### Bounded composition boundaries

Web scope journey uses real ScopeProvider, QueryClient, queries, Sidebar and API; its ScopedSidebar harness composes those public components without implementing their behavior. Web action journeys use real renderer, action hooks and HTTP client. VoiceControls uses real voice conversion and stubs only media/network ports. Android journeys render the real App and navigation/providers/client, with network, secure-storage and notification ports controlled. Apple composition uses real AppState/DaemonClient/URLSession with URLProtocol responses and PlatformAffordances recording. These prove client composition, not a running daemon, OS UI rendering, a network socket or provider-side action lifecycle. Component tests using supplied context/callbacks claim component behavior only.

### LOC accounting

Physical lines including blanks/comments. Executable-test LOC includes test files and their embedded helper code; authored-support LOC counts separate test utilities, fixtures, setup, and ScopeFixtures.swift. Generated JSON/bindings, package manifests, lockfiles and build/evidence scripts are excluded. Baseline file-level counts below were independently checked against Git HEAD during repair. Scenario names above identify the pre-pruning tests; narrowed scenarios can have revised names in the final source. No new test/support files were added.

| Runtime | Test files before → after | Executable-test LOC before → after | Authored-support LOC before → after |
| --- | ---: | ---: | ---: |
| web | 11 → 9 | 1,510 → 1,223 | 127 → 127 |
| mobile | 9 → 9 | 945 → 794 | 160 → 160 |
| apple | 5 → 3 | 1,431 → 1,189 | 32 → 32 |

Classified baseline executable scenarios: 122. Authored support files: 6. Unresolved: 0.

### Per-file LOC accounting

Physical source lines, using the same inclusion rules as the runtime totals above. A zero after count identifies a deleted file.

| Runtime | Kind | Path | Before | After |
| --- | --- | --- | ---: | ---: |
| web | support | `clients/web/src/test-setup.ts` | 43 | 43 |
| web | test | `clients/web/src/hooks/use-daemon-events.test.tsx` | 97 | 97 |
| web | test | `clients/web/src/lib/scope-context-navigation.test.tsx` | 129 | 45 |
| web | test | `clients/web/src/lib/utils.test.ts` | 56 | 56 |
| web | support | `clients/web/src/lib/scope-context.test-utils.tsx` | 40 | 40 |
| web | test | `clients/web/src/lib/scope-context.test.tsx` | 222 | 222 |
| web | test | `clients/web/src/api/client-ui.test.ts` | 76 | 0 |
| web | test | `clients/web/src/api/resource-state.test.ts` | 37 | 37 |
| web | test | `clients/web/src/api/voice.test.ts` | 132 | 0 |
| web | test | `clients/web/src/components/sidebar/Sidebar.test.tsx` | 99 | 99 |
| web | test | `clients/web/src/components/chat/VoiceControls.test.tsx` | 250 | 253 |
| web | test | `clients/web/src/components/shared-ui/SharedUiSurface.test.tsx` | 84 | 84 |
| web | test | `clients/web/src/components/shared-ui/SharedUiSurface.interactions.test.tsx` | 328 | 330 |
| web | support | `clients/web/src/components/shared-ui/SharedUiSurface.test-utils.tsx` | 44 | 44 |
| mobile | support | `clients/mobile/jest.setup.js` | 14 | 14 |
| mobile | test | `clients/mobile/src/__tests__/AppPlatformOwnership.test.tsx` | 45 | 45 |
| mobile | test | `clients/mobile/src/__tests__/routeNotificationResponse.test.ts` | 41 | 41 |
| mobile | test | `clients/mobile/src/__tests__/SharedUiGraph.test.ts` | 77 | 62 |
| mobile | test | `clients/mobile/src/__tests__/voiceClient.test.ts` | 133 | 133 |
| mobile | test | `clients/mobile/src/__tests__/SharedUiSurface.test.tsx` | 143 | 79 |
| mobile | test | `clients/mobile/src/__tests__/daemonClient.test.ts` | 67 | 67 |
| mobile | test | `clients/mobile/src/__tests__/SharedUiProductionJourney.test.tsx` | 235 | 236 |
| mobile | support | `clients/mobile/src/__tests__/SharedUiProductionJourney.test-fixture.ts` | 146 | 146 |
| mobile | test | `clients/mobile/src/__tests__/SharedUiActionParameters.test.ts` | 113 | 90 |
| mobile | test | `clients/mobile/src/__tests__/daemonClient-ui.test.ts` | 91 | 41 |
| apple | test | `clients/apple/Tests/KotaSharedTests/DaemonContractGeneratedTests.swift` | 20 | 0 |
| apple | support | `clients/apple/Tests/KotaSharedTests/ScopeFixtures.swift` | 32 | 32 |
| apple | test | `clients/apple/Tests/KotaSharedTests/SharedUiRendererTests.swift` | 913 | 781 |
| apple | test | `clients/apple/Tests/KotaSharedTests/DaemonClientErrorTests.swift` | 114 | 114 |
| apple | test | `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | 374 | 294 |
| apple | test | `clients/apple/Tests/KotaMenuBarTests/MenuBarRenderedTests.swift` | 10 | 0 |
