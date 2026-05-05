---
id: task-migrate-the-voice-kotaclient-namespace-end-to-end
title: Migrate the voice KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: done
priority: p1
area: architecture
summary: Move VoiceClient interface and the VoiceTranscribeOptions/VoiceTranscribeResult/VoiceSynthesizeOptions/VoiceSynthesizeResult types from src/core/server/kota-client.ts into src/modules/voice/client.ts; add a daemonClient(link) factory to the voice module that wires POST /voice/transcribe and POST /voice/synthesize through the typed DaemonTransport with base64 JSON binary-payload encoding/decoding; remove voiceTranscribeHttp/voiceSynthesizeHttp/voiceTranscribeNamespaceHttp/voiceSynthesizeNamespaceHttp, the VoiceTranscribeResponse/VoiceSynthesizeResponse types, the inline voice handler closure, and the DaemonControlClient.voiceTranscribe()/voiceSynthesize() direct methods from src/core/server/daemon-client.ts.
created_at: 2026-05-05T04:18:37.745Z
updated_at: 2026-05-05T04:37:40.459Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (`927dca24`), the audit migration (`b6278cf1`), the retract
migration (`8c212f0c`), the answer migration (`eb392cd1`), the
ownerQuestions migration (`68b74850`), the modules migration
(`c143c892`), the modulesAdmin migration (`03485329`), the agents
migration (`7965beb6`), the skills migration (`f62bbb65`), the
mcpServer migration (`10877651`), the web migration (`f79a2ee5`), the
capture migration (`e0e9aa93`), the recall migration (`5ab2bd0b`), the
webhook migration (`201d35ce`), the approvals migration (`e0030ada`),
the secrets migration (`5841c7f0`), the memory migration (`5bcc9e24`),
the knowledge migration (`d346a5c7`), the history migration
(`a38978c8`), and the evalHarness migration (`d3afe7e7`, 2026-05-05)
have validated the `daemonClient(link)` foundation pattern by moving
twenty-one namespaces out of `src/core/server/kota-client.ts` and
`src/core/server/daemon-client.ts` into their owning modules. 6
namespaces still have their TypeScript shape and daemon-side wire code
centralized in those two files (`kota-client.ts` is 696 lines,
`daemon-client.ts` is 1211 lines, both still well over the 300-line
guideline).

The next-cleanest namespace that fits the same multi-method
end-to-end shape is `voice`:

- 2 methods (`transcribe(options)`, `synthesize(options)`) — a
  POST/POST pair that exercises the binary-payload axis evalHarness's
  `## Source / Intent` explicitly named as the next-de-risked target
  ("the upcoming voice namespace migration that shares the binary-
  payload-with-`fetchRaw` shape").
- Already owned by a dedicated module under `src/modules/voice/` with
  its own `localClient(ctx)` factory (`index.ts` line 44), control
  routes (`voiceControlRoutes()` registered against the daemon at
  `/voice/transcribe` POST and `/voice/synthesize` POST in
  `routes.ts`), API routes (`voiceRoutes()` at `/api/voice/transcribe`
  and `/api/voice/synthesize` POST in `routes.ts`), and CLI
  (`buildVoiceCommand` in `cli.ts`).
- ~40 lines of namespace-owned types in `kota-client.ts` (lines
  449–488):
  - `VoiceTranscribeOptions` (lines 449–454, 6 lines): the `{ audio:
    Uint8Array; mimeType: string; filename?: string; languageHint?:
    string }` request options.
  - `VoiceTranscribeResult` (lines 456–465, 10 lines): the three-arm
    `{ ok: true; text; language? } | { ok: false; reason:
    "daemon_required" } | { ok: false; reason: "transport_error";
    status; message; code? }` discriminated union.
  - `VoiceSynthesizeOptions` (lines 467–472, 6 lines): the `{ text:
    string; voice?: string; languageHint?: string; format?: string }`
    request options.
  - `VoiceSynthesizeResult` (lines 474–483, 10 lines): the three-arm
    `{ ok: true; audio: Buffer; mimeType; format } | { ok: false;
    reason: "daemon_required" } | { ok: false; reason:
    "transport_error"; status; message; code? }` discriminated union.
  - `VoiceClient` (lines 485–488, 4 lines).
  - The supporting doc comment (lines 440–448).
- ~123 lines of wire code in `daemon-client.ts` —
  `VoiceTranscribeResponse` / `VoiceSynthesizeResponse` types (lines
  56–62, 7 lines), `voiceTranscribeHttp` (lines 195–224, 30 lines),
  `voiceSynthesizeHttp` (lines 226–250, 25 lines),
  `voiceTranscribeNamespaceHttp` (lines 252–271, 20 lines),
  `voiceSynthesizeNamespaceHttp` (lines 273–293, 21 lines), the
  inline `voice: { transcribe, synthesize }` closure on the central
  handler builder (lines 852–855, 4 lines), the
  `DaemonControlClient.voiceTranscribe()` direct method (lines
  1190–1197, 8 lines), the `DaemonControlClient.voiceSynthesize()`
  direct method (lines 1199–1206, 8 lines), plus the
  `VoiceSynthesizeOptions` / `VoiceSynthesizeResult` /
  `VoiceTranscribeOptions` / `VoiceTranscribeResult` imports from
  `./kota-client.js` (voice-namespace block in lines 35–38).
- The wire code today issues POST `/voice/transcribe` (with the audio
  Uint8Array re-encoded to a `audioBase64` string in the JSON body
  via `Buffer.from(audio).toString("base64")`) and POST
  `/voice/synthesize` (with the text/voice/languageHint/format
  options as the JSON body) through `transport.fetchRaw` directly,
  parsing the response JSON and reshaping the daemon's
  `audioBase64` field on `synthesize` back into a Node `Buffer` via
  `Buffer.from(audioBase64, "base64")`. Both methods discriminate
  `res.ok` to choose between `{ ok: true, ... }` arms and `{ ok:
  false, status, error, code? }` intermediate-shape arms; the
  namespace handlers `voiceTranscribeNamespaceHttp` and
  `voiceSynthesizeNamespaceHttp` then collapse those into the
  client-contract `{ ok: false, reason: "transport_error", status,
  message, code? }` shape.
- The voice module's local consumer (`index.ts`) currently does not
  import `VoiceClient` from `#core/server/kota-client.js` because the
  `localVoiceClient()` factory in `voice-operations.ts` returns the
  handler shape inline. After the migration, `voice-operations.ts`
  imports `VoiceClient` from the module-local `client.ts`, mirroring
  every prior namespace migration whose local factory consumed the
  client interface.

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — the same
shape as the prior pilots. The shape extends the pattern in three
new dimensions: (a) the first migration whose payload involves
**binary content** (`audio: Uint8Array` on transcribe input,
`audio: Buffer` on synthesize output) — the wire shape encodes both
through base64 JSON fields (`audioBase64` on the request body and
`audioBase64` on the response body) rather than `multipart/form-data`
or raw body bytes, validating that the typed `DaemonTransport` link
cleanly threads JSON-serializable wire transformations of binary
payloads when the wire shape matches the route's existing JSON
contract; (b) the first migration whose contract carries a
**`reason: "daemon_required"` arm at the namespace shape** (today
this arm is only emitted by the local handler, never by the
daemon-side path; the daemon-side factory never returns it), forcing
an explicit pin in the wire-shape test that the daemon factory's
result type never produces `daemon_required` — this is a contract-
shape distinction the namespace registry must surface honestly,
matching the sessions migration's upcoming `daemon_required` arm
shape; and (c) the first migration whose contract uses a
**`transport_error` arm with optional `code` field** that the wire
code propagates verbatim from the daemon's JSON `code` field
(transcribe and synthesize both surface provider error codes —
`STT_PROVIDER_UNAVAILABLE`, `SYNTHESIS_FORMAT_ERROR`, etc. — to the
caller), validating that `link.fetchRaw` plus inline JSON parsing is
the right primitive for wire shapes whose error envelopes carry
non-standard structured fields beyond `error`/`message`.

## Desired Outcome

`voice` is the twenty-second namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `VoiceClient`, `VoiceTranscribeOptions`, `VoiceTranscribeResult`,
  `VoiceSynthesizeOptions`, and `VoiceSynthesizeResult` live in
  `src/modules/voice/client.ts`. The aggregate `KotaClient` interface
  in `src/core/server/kota-client.ts` imports `VoiceClient` from this
  module instead of declaring the types inline. The narrow
  `no-module-imports-in-core` allowlist (today: `server/kota-
  client.ts`) already covers the import; no allowlist edit is
  needed.
- `src/modules/voice/index.ts` adds a `daemonClient(link)` factory
  parallel to its existing `localClient(ctx)` factory. The factory
  returns `{ voice: VoiceClient }` whose two methods route through:
  - `transcribe(options)` → re-encodes `options.audio` (`Uint8Array`)
    to `audioBase64` (`string`) via `Buffer.from(options.audio).
    toString("base64")`, builds the JSON body shape `{ audioBase64,
    mimeType, filename?, languageHint? }` (the optional fields are
    omitted entirely when undefined, matching today's
    `voiceTranscribeHttp` behavior), and calls
    `link.fetchRaw("/voice/transcribe", { method: "POST", headers: {
    "Content-Type": "application/json" }, body: JSON.stringify(body)
    })`. On `res.ok`, parses the JSON body and returns `{ ok: true,
    text: String(parsed.text ?? ""), ...(typeof parsed.language ===
    "string" && { language: parsed.language }) }`. On non-ok,
    returns `{ ok: false, reason: "transport_error", status:
    res.status, message: asString(parsed.error), ...(parsed.code !==
    undefined && { code: asString(parsed.code) }) }`. The factory
    never returns the `daemon_required` arm — only the local
    handler emits that arm when no daemon is reachable.
  - `synthesize(options)` → builds the JSON body shape `{ text,
    voice?, languageHint?, format? }` (optional fields omitted when
    undefined, matching today's `voiceSynthesizeHttp` body — today's
    central code passes `input` directly, but the migration spreads
    only the defined keys for explicit wire-shape parity with the
    transcribe path) and calls `link.fetchRaw("/voice/synthesize",
    { method: "POST", headers: { "Content-Type": "application/json"
    }, body: JSON.stringify(body) })`. On `res.ok`, parses the JSON
    body and returns `{ ok: true, audio: Buffer.from(String(parsed.
    audioBase64 ?? ""), "base64"), mimeType: String(parsed.mimeType
    ?? ""), format: String(parsed.format ?? "") }`. On non-ok,
    returns the same `{ ok: false, reason: "transport_error",
    status, message, code? }` shape as transcribe. The factory
    never returns the `daemon_required` arm.

  matching today's `voiceTranscribeHttp` / `voiceSynthesizeHttp` URL
  paths, HTTP verbs, JSON-body contracts, and base64 wire-shape
  encoding/decoding byte-for-byte. The control-route stem
  (`/voice/*`) is preserved — do not migrate the route to
  `/api/voice/*` (the `kota serve` API server registers `/api/
  voice/*` as a parallel surface for browser clients, but
  `DaemonControlClient` calls the control-plane `/voice/*` routes
  exclusively, and that contract must stay intact).
- `src/core/server/daemon-client.ts` no longer carries
  `VoiceTranscribeResponse`, `VoiceSynthesizeResponse`,
  `voiceTranscribeHttp`, `voiceSynthesizeHttp`,
  `voiceTranscribeNamespaceHttp`, `voiceSynthesizeNamespaceHttp`,
  the inline `voice: { transcribe, synthesize }` closure on the
  core-side stub builder, the `voiceTranscribe()` and
  `voiceSynthesize()` direct methods on the `DaemonControlClient`
  class, the `VoiceSynthesizeOptions` / `VoiceSynthesizeResult` /
  `VoiceTranscribeOptions` / `VoiceTranscribeResult` imports from
  `./kota-client.js`, or any other voice-namespace-specific
  helpers. Module-contributed handlers replace the namespace path
  the same way every prior migration did. The two
  `DaemonControlClient` direct methods are removed because the
  namespace path `client.voice.transcribe()` /
  `client.voice.synthesize()` is the only sanctioned operator-CLI
  surface — there are no remaining `src/` callers of either
  direct method (the external clients under `clients/apple/*`,
  `clients/web/*`, and `clients/mobile/*` have their own
  `DaemonClient` implementations and reference the wire shape
  from documentation, not the class).
- `src/modules/voice/voice-operations.ts` imports `VoiceClient`
  from `./client.js` (the new module-local file) instead of
  declaring its handler shape inline as `{ voice: VoiceClient }`
  with the type pulled from `#core/server/kota-client.js`. The
  module's `index.ts` continues to consume
  `localVoiceClient()` unchanged.
- A new daemon-side factory unit test alongside the module
  (`src/modules/voice/daemon-client.test.ts`) exercises the wire
  shape against a recording `DaemonTransport`, mirroring
  `src/modules/history/daemon-client.test.ts`,
  `src/modules/knowledge/daemon-client.test.ts`,
  `src/modules/eval-harness/daemon-client.test.ts`, and the prior
  multi-method pilots. The test pins (1) the factory contributes
  `voice`, (2) `transcribe(options)` routes through `fetchRaw`
  with method `POST`, path `/voice/transcribe`, headers `{
  "Content-Type": "application/json" }`, and body
  `{ audioBase64: <base64-of-audio>, mimeType, filename?,
  languageHint? }` — including a call with only the required
  fields and a call with every optional key set to pin the JSON
  shape, (3) `transcribe(options)` decodes the success arm
  correctly: a `200 + { text: "hello" }` response collapses to
  `{ ok: true, text: "hello" }` and a `200 + { text: "hi",
  language: "en" }` response collapses to `{ ok: true, text: "hi",
  language: "en" }`, (4) `transcribe(options)` decodes the
  transport_error arm correctly: a `502 + { error: "stt down",
  code: "STT_PROVIDER_UNAVAILABLE" }` response collapses to
  `{ ok: false, reason: "transport_error", status: 502, message:
  "stt down", code: "STT_PROVIDER_UNAVAILABLE" }` and a `400 + {
  error: "bad mime" }` response (no code) collapses to `{ ok:
  false, reason: "transport_error", status: 400, message: "bad
  mime" }` (the `code` key omitted entirely, not set to undefined),
  (5) `synthesize(options)` routes through `fetchRaw` with method
  `POST`, path `/voice/synthesize`, headers `{ "Content-Type":
  "application/json" }`, and body `{ text, voice?, languageHint?,
  format? }` — including a call with only the required fields and
  a call with every optional key set to pin the JSON shape, (6)
  `synthesize(options)` decodes the success arm correctly: a
  `200 + { audioBase64: "<base64>", mimeType: "audio/mp4", format:
  "mp4" }` response collapses to `{ ok: true, audio:
  Buffer.from("<base64>", "base64"), mimeType: "audio/mp4",
  format: "mp4" }`, (7) `synthesize(options)` decodes the
  transport_error arm correctly: a `503 + { error: "tts down",
  code: "SYNTHESIS_PROVIDER_UNAVAILABLE" }` response collapses to
  `{ ok: false, reason: "transport_error", status: 503, message:
  "tts down", code: "SYNTHESIS_PROVIDER_UNAVAILABLE" }`, (8)
  `synthesize(options)` decodes the format-error arm correctly: a
  `400 + { error: "format not supported", code:
  "SYNTHESIS_FORMAT_ERROR" }` response collapses to `{ ok: false,
  reason: "transport_error", status: 400, message: "format not
  supported", code: "SYNTHESIS_FORMAT_ERROR" }`, (9) the
  daemon-side factory NEVER returns the `daemon_required` arm —
  the test asserts the factory's TypeScript result type does not
  include the `daemon_required` arm at the wire-shape level, and
  asserts no test case constructs an `{ ok: false, reason:
  "daemon_required" }` response from the factory, (10) the
  assembly satisfies coverage with the voice contribution, and
  (11) the assembly throws naming `"voice"` when the contribution
  is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-
  client.test.ts` extends with `"voice"`, and
  `buildMigratedNamespaceTestStubs()` in `src/core/server/daemon-
  client-test-stubs.ts` extends with a stub `voice` handler whose
  two methods return the placeholder shapes
  (`transcribe()` → `{ ok: false, reason: "transport_error",
  status: 503, message: "stub" }`, `synthesize()` → `{ ok: false,
  reason: "transport_error", status: 503, message: "stub" }`) so
  tests that build a `DaemonControlClient` purely to exercise
  non-namespace daemon behavior continue to pass coverage.
- The voice module's `AGENTS.md` is updated to remove the lines
  describing `DaemonControlClient.voiceTranscribe` /
  `voiceSynthesize` as the daemon-side surface (lines 31–32 and
  47–52). The replacement description points at `client.voice.
  transcribe()` / `synthesize()` as the namespace-path surface
  through the `daemonClient(link)` factory hook.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes.
  The `/voice/transcribe` and `/voice/synthesize` POST routes keep
  their HTTP verbs, JSON-body contracts, and base64 wire-shape
  encoding/decoding exactly as parsed in
  `src/modules/voice/routes.ts`. The CLI-facing `kota voice`
  subcommands (`transcribe`, `synthesize`), the audio file
  encoding helpers, and the playback path are unrelated to this
  migration and must not be touched.
- The daemon-side handler uses `link.fetchRaw` through the typed
  `DaemonTransport`. It does not reach into `node:http`, the
  bearer token, or `.kota/daemon-control.json`. The HTTP method
  and path stay byte-for-byte identical to today's wire code,
  including the `"Content-Type": "application/json"` header on
  both POST bodies.
- The control-plane stem (`/voice/*`) is preserved. The
  `daemonClient` factory does not migrate the route to
  `/api/voice/*` — the `kota serve` API server registers
  `/api/voice/*` as a parallel surface for browser clients
  (`voiceRoutes()` in `routes.ts`) and that surface is
  independent of the daemon-control path; renaming the
  control-plane route would break the `DaemonControlClient` wire
  contract and is out of scope.
- The base64 wire-shape transform is preserved exactly in both
  directions: `Buffer.from(input.audio).toString("base64")` on
  transcribe-request encoding, `Buffer.from(parsed.audioBase64,
  "base64")` on synthesize-response decoding. Do not switch to
  `multipart/form-data`, raw bytes, `data:` URIs, or any other
  encoding — the daemon route parses `audioBase64` JSON strings
  and that decision is out of scope here.
- The two-direction binary contract is preserved exactly:
  `transcribe.audio` stays `Uint8Array` on the input shape (the
  client can pass a Node `Buffer`, a browser `Uint8Array`, or
  any other view), and `synthesize.audio` stays a Node `Buffer`
  on the success shape (the client receives a `Buffer` ready
  for `fs.writeFileSync` or `Response` body). The migration
  preserves these types byte-for-byte; do not narrow either to
  `Buffer` only or widen either to `ArrayBuffer | Uint8Array`.
- The `daemon_required` arm stays on the `VoiceTranscribeResult`
  and `VoiceSynthesizeResult` discriminated unions in
  `src/modules/voice/client.ts`. The local handler in
  `voice-operations.ts` continues to emit it when no daemon is
  reachable, exactly as today. The daemon-side factory never
  emits it. The daemon-side test pins this contract distinction
  explicitly.
- No legacy or compatibility surface. Delete `voiceTranscribeHttp`,
  `voiceSynthesizeHttp`, `voiceTranscribeNamespaceHttp`,
  `voiceSynthesizeNamespaceHttp`, `VoiceTranscribeResponse`,
  `VoiceSynthesizeResponse`, the inline closure, the central type
  declarations, the `DaemonControlClient.voiceTranscribe()` and
  `voiceSynthesize()` direct methods, and the
  `VoiceSynthesizeOptions` / `VoiceSynthesizeResult` /
  `VoiceTranscribeOptions` / `VoiceTranscribeResult` imports at
  the migration's edges as it completes; do not leave shims. The
  in-module import shift in `voice-operations.ts` from
  `#core/server/kota-client.js` to `./client.js` is a hard
  cutover, not a parallel re-export.
- The three-arm shapes (`{ ok: true; ... } | { ok: false; reason:
  "daemon_required" } | { ok: false; reason: "transport_error";
  status; message; code? }`) are preserved exactly in the client
  contract for both `VoiceTranscribeResult` and
  `VoiceSynthesizeResult`. The optional `code` field stays an
  optional union with the `code` key omitted entirely (not set
  to `undefined`) when the daemon response does not include
  one — same precedent as the `language` optional field on
  `transcribe`'s success arm.
- The daemon-up branch's transport behavior preserves today's
  semantics: both methods return the typed discriminated union
  end-to-end without throwing for the `transport_error` arm; the
  daemon's `400`, `500`, `502`, `503` status codes all collapse
  uniformly into the `transport_error` shape, mirroring today's
  `voiceTranscribeNamespaceHttp` / `voiceSynthesizeNamespaceHttp`
  behavior. Only genuinely unexpected failures (network errors,
  malformed JSON, unknown HTTP shape) propagate as thrown
  errors.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `VoiceTranscribeOptions` /
  `VoiceTranscribeResult` / `VoiceSynthesizeOptions` /
  `VoiceSynthesizeResult` declarations in `src/core/server/`.
  Existing assertions for the doctor, harnessParity, audit,
  retract, answer, ownerQuestions, modules, modulesAdmin,
  agents, skills, mcpServer, web, capture, recall, webhook,
  approvals, secrets, memory, knowledge, history, and
  evalHarness migrations stay green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no
  allowlist edit is needed for this migration.
- No protocol change for the operator-facing CLI. CLI behavior
  (`kota voice transcribe`, `kota voice synthesize`),
  daemon-up vs daemon-down branching, and exit-code semantics
  all continue to behave identically.
- Output continues to flow through `src/modules/rendering`. The
  voice module's existing CLI rendering hooks are not part of
  this refactor.
- The mobile, web, and apple clients (`clients/mobile/*`,
  `clients/web/*`, `clients/apple/*`) are out of scope. They
  have their own `DaemonClient` implementations and reference
  the wire shape from documentation rather than importing the
  central class. The migration removes the
  `DaemonControlClient.voiceTranscribe()` /
  `voiceSynthesize()` direct methods because no `src/` code
  consumes them; this does not affect external clients.

## Done When

- `src/modules/voice/client.ts` exists and declares
  `VoiceClient`, `VoiceTranscribeOptions`,
  `VoiceTranscribeResult`, `VoiceSynthesizeOptions`, and
  `VoiceSynthesizeResult`. The `KotaClient` aggregate in
  `src/core/server/kota-client.ts` imports `VoiceClient` from
  this module.
- `src/modules/voice/index.ts` exposes `daemonClient(link)`
  parallel to `localClient(ctx)`.
- `src/modules/voice/voice-operations.ts` imports
  `VoiceClient` from `./client.js` (not from
  `#core/server/kota-client.js`).
- `src/core/server/daemon-client.ts` no longer carries any
  `voice`-specific code: no `voiceTranscribeHttp`,
  `voiceSynthesizeHttp`, `voiceTranscribeNamespaceHttp`,
  `voiceSynthesizeNamespaceHttp`; no
  `VoiceTranscribeResponse` or `VoiceSynthesizeResponse`
  types; no inline `voice: { ... }` closure on the core-side
  stub builder; no `DaemonControlClient.voiceTranscribe()` or
  `voiceSynthesize()` direct methods; no
  `VoiceSynthesizeOptions` / `VoiceSynthesizeResult` /
  `VoiceTranscribeOptions` / `VoiceTranscribeResult` imports;
  and no other voice-namespace-specific helpers.
- `src/modules/voice/daemon-client.test.ts` exists and pins the
  invariants enumerated in `## Desired Outcome` above (factory
  presence, wire-shape assertions covering both POST routes
  with the base64 binary-payload encoding/decoding,
  per-arm `VoiceTranscribeResult` decoding for success and
  transport_error arms, per-arm `VoiceSynthesizeResult`
  decoding for success and transport_error arms,
  daemon-side-never-emits-`daemon_required` invariant,
  coverage success when the contribution is supplied, and
  coverage failure when it is removed).
- `STUB_OMITTED_NAMESPACES` in
  `src/core/server/daemon-client.test.ts` extends to include
  `"voice"`, and `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a
  stub `voice` handler whose two methods return the placeholder
  shapes in `## Desired Outcome` above.
- `src/modules/voice/AGENTS.md` is updated to remove the lines
  describing `DaemonControlClient.voiceTranscribe` /
  `voiceSynthesize` as the daemon-side surface and replace
  them with the namespace-path description.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass
  and rejects deliberately re-introduced per-namespace
  `VoiceTranscribeOptions` / `VoiceTranscribeResult` /
  `VoiceSynthesizeOptions` / `VoiceSynthesizeResult`
  declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run
  directory (`voice-daemon-up.txt` / `voice-daemon-down.txt`)
  demonstrate parity for one read-shaped success path
  (`kota voice transcribe <small-fixture-audio-file>` with a
  test-fixture audio under `data/fixtures/` or a generated
  silence buffer; the daemon-down side surfaces
  `daemon_required` from the local handler so the no-daemon
  arm is exercised) and one error path (`kota voice
  synthesize --format flac` exercising the
  `SYNTHESIS_FORMAT_ERROR` arm via a deliberately-unsupported
  format) showing the pre/post output is identical across
  modes. If no STT/TTS provider is configured locally (the
  expected baseline in the autonomous run environment), the
  transcripts should exercise the `daemon_required` and
  provider-unavailable arms instead, capturing both modes
  honestly.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-05T04-18-37-745Z-explorer-26crli/` as the
next orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s`
(owner-decision slot
`kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Twenty-three orthogonal preludes have already landed (the
foundation / pilot / migration commits plus the evalHarness
migration):

- `a0a5e3e2` — typed `DaemonTransport` plus non-namespace
  transport-method decoupling (the orthogonal prelude needed
  under all chunking answers).
- `203c76a6` — `daemonClient(link)` factory hook on
  `KotaModule`, `DaemonClientHandlers` assembly path on
  `DaemonControlClient`, and the per-namespace types guard
  (`kota-client-namespace-types-guard.test.ts`).
- `9f07ee87` — doctor pilot migrating the smallest namespace
  end-to-end through the new hook.
- `927dca24` — harnessParity migration extending the pattern
  to a two-method namespace.
- `b6278cf1` — audit migration extending the pattern to a
  query-string-bodied namespace.
- `8c212f0c` — retract migration extending the pattern to a
  JSON-body POST with discriminated request/result unions.
- `eb392cd1` — answer migration extending the pattern to a
  multi-verb namespace mixing POST + GET + GET-with-path-id.
- `68b74850` — ownerQuestions migration extending the pattern
  to two POSTs sharing an id-bearing path stem.
- `c143c892` — modules migration extending the pattern to the
  smallest single-method namespace.
- `03485329` — modulesAdmin migration extending the pattern
  to the first multi-namespace contribution from a single
  module's `daemonClient(link)` factory and the first
  cross-namespace dependency consumption.
- `7965beb6` — agents migration extending the pattern to the
  first pure read-only namespace shape (two GETs) and
  validating the single-status-code → 200 alignment
  precedent for `404 → { found: false }`.
- `f62bbb65` — skills migration extending the pattern to the
  first multi-status-code → 200 alignment for a typed
  mutation result (collapsing `502` and `400` not-ok arms
  into uniform `200`).
- `10877651` — mcpServer migration establishing the
  stub-only daemon-side handler precedent.
- `f79a2ee5` — web migration generalizing the stub-only
  precedent.
- `e0e9aa93` — capture migration extending the pattern to a
  four-arm `CaptureResult` discriminated union.
- `5ab2bd0b` — recall migration extending the pattern to a
  five-arm `RecallHit` discriminated union including a
  nested four-arm `result` union on the answer arm.
- `201d35ce` — webhook migration extending the pattern to
  the DELETE verb plus `encodeURIComponent`-escaped workflow
  id path parameters.
- `e0030ada` — approvals migration extending the pattern to
  a query-string status discriminator threaded through
  `requestStrict<T>`, a two-arm mutation discriminated union
  keyed off the daemon's `404 → not_found` mapping, and a
  daemon-route default that anchors the daemon-up factory's
  omit-when-undefined behavior.
- `5841c7f0` — secrets migration extending the pattern to
  the PUT verb with a JSON body, a non-`not_found` mutation
  failure arm (`store_error` with optional message), and a
  DELETE-with-query-string request shape threaded through
  `encodeURIComponent`.
- `5bcc9e24` — memory migration extending the pattern with
  the first daemon-wire-to-client-contract shape
  transformation (`excerpt → content`, `tags` dropped,
  `limit` slicing) and the first `semantic_unavailable`
  discriminated-union arm wired through `requestStrict<T>`.
- `d346a5c7` — knowledge migration extending the pattern
  with the first multi-key URLSearchParams filter (six
  optional keys) wired through `requestStrict<T>` with a
  `semantic_unavailable` arm, the first namespace carrying
  both a `{ found: true | false }` show-arm and a
  `{ ok: false; reason: "not_found" }` delete-arm threaded
  through `request<T>`, and the first contract surfacing a
  provider type (`KnowledgeEntry`) verbatim from
  `#core/modules/provider-types.js` without a wire-shape
  transformation.
- `a38978c8` — history migration extending the pattern with
  the first two-stem route contract (`/history*` for
  list/show/delete/reindex plus `/api/history/search` for
  semantic search) threaded through the same factory, the
  first migration whose mutation path exercised an HTTP
  `204` success status (collapsed into the
  knowledge/approvals/secrets `200 + { deleted: id }`
  precedent), and the first migration whose contract
  surfaces a provider type (`ConversationData`) verbatim
  through the daemon route on a single arm of a
  discriminated union (the show arm).
- `d3afe7e7` — evalHarness migration extending the pattern
  with the first long-running POST shape (eval runs
  exceed the 2s default timeout) threaded through
  `link.requestStrict<T>` with an explicit `timeoutMs`
  override, the first regex-based-error-message
  discrimination (`/no fixtures/i.test(msg)`) reshaped
  into a `200 + { ok: false; reason; message }` typed
  failure body matching the skills precedent, and the
  first `Record<string, unknown>` pass-through result
  shape.

`voice` is the next-cleanest multi-method namespace with two
short HTTP wire calls (POST / POST) covering its complete
daemon contract — the natural next pilot in the cluster
that began with the doctor, harnessParity, ownerQuestions,
agents, capture, approvals, memory, knowledge, history, and
evalHarness migrations. It extends the pattern in three
axes the prior pilots did not exercise: (a) the first
migration whose payload involves binary content (`audio:
Uint8Array` on transcribe input, `audio: Buffer` on
synthesize output), validating that the typed
`DaemonTransport` link cleanly threads JSON-serializable
wire transformations of binary payloads through `fetchRaw`
when the wire shape matches the route's existing JSON
contract (base64 fields rather than `multipart/form-data`
or raw body bytes); (b) the first migration whose contract
carries a `reason: "daemon_required"` arm at the namespace
shape that only the local handler emits (the daemon-side
factory never returns it), forcing an explicit pin in the
wire-shape test that the daemon factory's result type
never produces `daemon_required` — this is a contract-
shape distinction the namespace registry must surface
honestly, matching the upcoming sessions migration's
identical `daemon_required` arm shape; and (c) the first
migration whose contract uses a `transport_error` arm
with optional `code` field that the wire code propagates
verbatim from the daemon's JSON `code` field (provider
error codes like `STT_PROVIDER_UNAVAILABLE` and
`SYNTHESIS_FORMAT_ERROR`), validating that `link.fetchRaw`
plus inline JSON parsing is the right primitive for wire
shapes whose error envelopes carry non-standard
structured fields beyond `error`/`message`. This
migration also removes the last two
`DaemonControlClient` non-namespace direct methods
(`voiceTranscribe()` and `voiceSynthesize()`) — the
orthogonal prelude task `task-decouple-non-namespace-
daemon-transport-methods-fr` left them in place because no
`src/` consumers existed; the namespace migration
displaces them now, shrinking the parent task by both the
namespace footprint and the residual class-method
footprint. It is needed under every chunking answer the
owner can pick on the parent task (a/b/c/d/unblock): the
voice namespace migrates exactly once regardless of
whether the parent lands in one cohesive run or fans out
across follow-ups, so this task does not commit the
owner to any specific chunking answer; it shrinks the
parent task's scope by one full namespace whichever
answer wins.

## Initiative

Module-first, core-shrinking architecture: every
operator-facing capability — including its KotaClient
contract — lives in the owning module, with `src/core/`
reduced to genuine cross-cutting protocols and runtime
primitives.

## Acceptance Evidence

- Diff covering namespace type and wire-code moves out of
  `src/core/server/`, the new `daemonClient(link)` factory
  on `voiceModule`, the in-module import shift in
  `voice-operations.ts`, the removed `voiceTranscribeHttp`
  / `voiceSynthesizeHttp` /
  `voiceTranscribeNamespaceHttp` /
  `voiceSynthesizeNamespaceHttp` /
  `VoiceTranscribeResponse` / `VoiceSynthesizeResponse` /
  inline closure / `DaemonControlClient.voiceTranscribe` /
  `DaemonControlClient.voiceSynthesize` / imports from
  `src/core/server/daemon-client.ts`, the AGENTS.md
  edit in `src/modules/voice/`, and the new daemon-side
  unit test.
- Line-count snapshots of `src/core/server/kota-client.ts`
  and `src/core/server/daemon-client.ts` before and after,
  showing the expected ~50-line and ~123-line shrinkage
  respectively.
- Daemon-up and daemon-down CLI transcripts under the run
  directory (`voice-daemon-up.txt` /
  `voice-daemon-down.txt`) exercising the daemon-down
  `daemon_required` arm and the provider-unavailable or
  format-error arm with identical CLI output across modes
  (the autonomous run environment is expected to lack
  configured STT/TTS providers, so both daemon-up and
  daemon-down transcripts will exercise the no-provider
  paths honestly rather than fabricating synthesis output).
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the
  current tree and fails on a deliberately re-introduced
  `VoiceTranscribeOptions` / `VoiceTranscribeResult` /
  `VoiceSynthesizeOptions` / `VoiceSynthesizeResult`
  declaration in `src/core/server/`.
