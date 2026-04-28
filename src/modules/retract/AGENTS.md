# Retract Module

Cross-store retract seam — the symmetric correction-side counterpart to
capture. One typed identifier plus an explicit target removes one prior
record from the right store.

## What this module owns

- The `RetractProvider` primitive and its single in-process implementation.
- The typed `RetractContributor` protocol every store implements — each
  arm consumes only its target's strict identifier shape so the type
  system rejects e.g. a memory `id` passed to the knowledge contributor.
- One daemon-control route (`POST /retract`) plus its user-facing twin
  (`POST /api/retract`) — both share `createRetractRouteHandler` so the
  wire shape cannot drift between operator surfaces.
- One `KotaClient.retract` namespace and one `kota retract` CLI
  subcommand rendered through `src/modules/rendering`.
- One agent-callable tool (`retract`) contributed through the standard
  `KotaModule.tools` path with a `dangerous` risk classification (the
  seam permanently removes user data or moves a task to dropped).
- One per-turn dynamic system-prompt contributor (entry point
  `buildRetractDynamicStateProvider` in `system-prompt.ts`, registered
  through `ctx.registerDynamicStateProvider` during `onLoad`). The
  contributor emits the conversational-pattern block when the session's
  effective tool policy admits `retract`, and the empty string otherwise
  — so a session that cannot call the tool never sees instructions that
  reference it. The block tells the agent to retract on an explicit
  contradiction of a prior capture rather than appending a contradicting
  note.

## How a new store joins

A new contributor:

1. Adds a literal to the `RetractTarget` union and an arm to the
   `RetractRecord` discriminated union plus the matching arm to
   `RetractRequest` in `src/core/server/kota-client.ts`.
2. Adds an adapter in `contributors.ts` that wraps its removal helper
   into a `RetractContributor`.
3. Registers the new contributor in this module's `onLoad`.

The `RetractProvider` itself enumerates contributors at runtime through
its `register()` API; nothing in core hard-codes the contributor set.

## Routing rules

- `request.target` names exactly one contributor. Dispatch is verbatim.
- An unregistered named target → `no_contributors`.
- The contributor distinguishes "the record was not present" from
  "removal failed mid-flight" so the seam can surface those two as the
  separate `not_found` and `contributor_failed` arms.
- The seam never falls back into a different target when one contributor
  reports `not_found`; the operator (or agent) always names the store.

## Strict envelope contract

`RetractResult` is one of:

- `{ ok: true; record: RetractRecord }` — the contributor removed the
  record. `record` is discriminated by `target`; per-target arms carry
  the typed identifier (memory id, knowledge slug, task id, inbox file
  slug) plus path metadata when relevant. The tasks arm explicitly
  names the resulting state (`"dropped"`) so a caller can render
  "moved to dropped", not "deleted".
- `{ ok: false; reason: "no_contributors" }` — the seam itself is
  unconfigured for the named target.
- `{ ok: false; reason: "not_found"; target; identifier }` — the named
  record is not present in the named target.
- `{ ok: false; reason: "contributor_failed"; target; message }` — the
  chosen contributor threw mid-removal. The seam never silently retries
  into a different store.

## Tests

- Unit tests for the seam pieces sit beside the code: `tool.test.ts`,
  `system-prompt.test.ts`, `retract-provider.test.ts`,
  `contributors.test.ts`, `routes.test.ts`, `cli.test.ts`.
- Cross-store HTTP pipeline integration: `src/retract-pipeline.integration.test.ts`.
- Agent-loop integration anchors (shared with capture/recall/answer):
  - `src/conversational-agent-tools.integration.test.ts` exercises the
    `retract` tool end-to-end through the `openai-tools` harness against
    the production `RetractProviderImpl`, asserting a follow-up recall
    no longer surfaces the retracted record.
  - `src/conversational-prompt-priming.integration.test.ts` pins the
    `dynamic-state` admission gate for the retract block (positive when
    the tool is admitted, negative when it is excluded) and asserts the
    production retract provider settles the read-side seam.

## Boundaries

- No raw filesystem deletes for tasks. The tasks contributor routes
  through `moveTaskById(projectDir, id, "dropped")` so the state-machine
  invariants and `updated_at` / `git mv` semantics stay intact.
- No second registry, no second public retract path. `register()` is
  the single way new stores join.
- No fan-out from this module. Telegram, web, macOS, and mobile
  adoption land later as their own honest single-task follow-ups,
  matching the capture+recall+answer pattern.
