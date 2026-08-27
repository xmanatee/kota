---
status: done
---

# Add shared UI core status inbox surface fixture

## Problem

KOTA needs a shared UI contribution protocol, but trying to build every
surface family at once would repeat the current problem: a large internal
protocol can land without proving the operator experience improves. Status and
Inbox are the right first family because they are the control-plane surfaces
operators need before Work, Knowledge, or Setup can feel coherent.

## Desired Outcome

Define the first typed shared UI fixture and minimal action contract for
Status and Inbox. CLI, Web, and Apple decoders/renderers should be able to
consume the same fixture before broader workflow/module/setup surfaces are
added.

## Constraints

- Keep the protocol typed and client-neutral; do not use HTML as the source
  contract.
- Do not redesign all clients in this slice.
- Keep action execution as a typed envelope that names surface/action/scope and
  parameters; do not let renderers call arbitrary command strings.
- Reuse the existing `kota status` and `kota inbox` projections as the first
  semantic source.

## Done When

- A typed Status/Inbox UI surface fixture exists in client conformance.
- The fixture includes status summary, runtime warnings, inbox item list,
  direct actions, empty state, and error state.
- CLI renderer can render the fixture without losing the current status/inbox
  semantics.
- Web and Apple decoders accept the same fixture even if their full visual
  redesign stays in follow-up tasks.

## Source / Intent

Owner requested the full operator-first roadmap on 2026-06-11. The plan calls
for shared UI protocol before broad CLI/Web/Mac fan-out, starting from the
trustworthy Status and Inbox control-plane surfaces landed in this recovery
slice.

## Initiative

KOTA shared UI protocol, first operator-control surface family.

## Acceptance Evidence

- Client conformance fixture showing Status and Inbox surfaces.
- CLI transcript rendering the shared Status/Inbox fixture.
- Web decoder test and Apple decoder test accepting the same fixture.
- `pnpm validate-tasks`, relevant conformance tests, and CLI renderer tests pass.
