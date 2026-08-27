---
status: done
---

# Render shared UI surfaces in Apple clients

## Problem

Apple code decodes `UiSurfaceBundle` types but the production SwiftUI
experience does not consume the bundle. `OperatorSections.swift` separately
defines intent grouping, inbox aggregation, knowledge modes, work disclosures,
setup controls, and navigation. That duplicates daemon semantics even though
macOS and iOS already share one `KotaShared` target.

## Desired Outcome

`KotaShared` provides one exhaustive native SwiftUI renderer and action
executor for the generated UI contract. macOS and iOS shells supply only
platform affordances and presentation choices while using the same
daemon-declared surfaces and navigation.

## Constraints

- Keep native SwiftUI and the existing `PlatformAffordances` boundary; do not
  embed web content or duplicate this work in React Native iOS.
- Remove the old semantic `OperatorSections` catalog rather than preserving a
  compatibility mode.
- Native components may specialize appearance for a typed extension/node, but
  conditions, availability, confirmation, and action meaning remain daemon
  owned.
- Missing protocol expressiveness must be fixed in the canonical contract, not
  hidden in a Swift-only enum or state machine.

## Done When

- `DaemonClient` loads and refreshes the generated `UiSurfaceBundle` and the
  shared app state exposes it to both shells.
- An exhaustive SwiftUI renderer covers every generated node/action arm and
  routes external/file/platform operations through `PlatformAffordances`.
- macOS menu-bar and iOS window/tab shells derive their operator inventory from
  the bundle; hardcoded intent aggregation and action semantics are deleted.
- Offline, unavailable, confirmation, form, and live-update states are native
  and protocol driven on both platforms.

## Source / Intent

The owner asked for one interface definition rendered appropriately on macOS
and iOS. Audit evidence: `ContractTypes.swift` mirrors the protocol, while the
only production UI semantics are independently authored in
`OperatorSections.swift`; no Apple production code calls `/ui/surfaces`.

## Initiative

One canonical capability mechanism per KOTA boundary.

## Acceptance Evidence

- macOS and iOS screenshots or screencasts generated from the same captured
  daemon bundle, covering navigation, an unavailable action, a form, and a
  confirmed control action.
- A Swift runtime trace showing bundle decode, refresh, action execution, and
  platform-affordance delegation.
- A parity/search artifact proving the hardcoded Apple semantic catalog is no
  longer authoritative.

## Completion

`KotaShared` loads and refreshes generated `UiSurfaceBundle` values, renders
every node and action through shared native SwiftUI views, executes actions
through the daemon client/platform-affordance boundary, and drives both Apple
shells from the same protocol presentation. The former `OperatorSections`
catalog is absent.
