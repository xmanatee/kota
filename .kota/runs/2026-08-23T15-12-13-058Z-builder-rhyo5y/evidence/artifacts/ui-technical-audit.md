# Android shared UI technical audit

Overall score: **94/100**. No unresolved P0 or P1 implementation findings;
release evidence remains blocked on the required Android emulator capture.

## Scores

| Area | Score | Evidence |
| --- | ---: | --- |
| Accessibility | 96 | Native roles, labels, disabled/selected/value state, alerts, 48 dp interactive targets, and text contrast of at least 5.23:1 for the renderer palette. |
| Performance | 94 | Bottom tabs remain lazy, native stacks render the active graph route, live bundle refreshes are coalesced over 200 ms, live log tails are bounded to 100 entries per stream, and daemon-route document previews are capped at 120,000 characters. |
| Contract safety | 98 | The generated `ui.surface.v1` parser owns ingress; node/action/condition/permission/link unions use exhaustive `never` guards; action results fail closed on unknown arms. |
| Responsive layout | 94 | Rows, metrics, requirements, options, and intent tabs wrap; surface content scrolls and refreshes natively; long scope/status text is bounded. |
| Theming and visual consistency | 88 | One consistent light operator palette and role color system is used. The established mobile client does not yet expose a dark-theme token layer. |
| Resilience | 95 | Loading, empty, connection, unavailable, setup-required, error, confirmation, validation, stale deep-link, cross-scope event, and refresh-failure states are explicit. |

## Automated checks

- `pnpm --dir clients/mobile typecheck`: passed.
- Android Jest preset: 38 suites and 457 tests passed, one suite/test intentionally skipped, and one snapshot passed.
- Cross-client/binding/ownership/distribution and push notification tests: 6 files, 33 tests; all passed.
- Root `pnpm typecheck`: passed.
- Canonical generated fixture: all 17 `UiNode` union arms rendered through the production React Native renderer.
- Captured cross-client bundle: 20 surfaces, five graph-derived intents, 55 stable actions, and every surface rendered.
- Legacy navigation/decoder search: zero operator-intent modules, notification screen discriminators, semantic route helpers, literal intent route maps, or copied UI contract definitions.
- Interactive target scan: no shared-UI/navigation target below 48 dp.
- Palette contrast checks on white: info 5.56:1, muted 5.23:1, warning 5.40:1, success 5.34:1, error 6.57:1; white on primary blue 5.56:1.
- Evidence fixture server check: the canonical captured bundle validates as
  `ui.surface.v1` with 20 surfaces and SHA-256
  `5d8e3e996ba012095d5335bb584a1bfb476706a956c1607f556aef49732130be`.
- Platform-ownership integration check: iOS and Expo web render only the
  ownership notice and make zero secure-store, notification-listener, or
  push-token calls; the Android production journey remains green.

## Findings

- **P2 — evidence environment:** the sandbox blocks the ADB listener and Android emulator runtime libraries. The run therefore includes PNG/HTML rendered fixtures generated from the production React Native host tree, plus the complete native tree and interaction trace, but does not claim an emulator capture. See `android-emulator-probe.json`.
- **Resolved P1 — authenticated links:** `daemon-route` links now stay in the
  native stack, fetch through the bearer-authenticated `DaemonClient`, strictly
  decode JSON, and expose loading/error/document states. External URLs remain
  device-browser links. Production-provider integration coverage verifies the
  authorization header without recording the token.
- **Resolved P1 — production entrypoint:** `package.json#main` now resolves to
  the installed Expo `AppEntry`; a regression test loads that declared module
  and proves it registers the production `App`. The Android journey mounts
  `App` itself, processes notification and SSE ingress through the real
  production callbacks, observes the resulting graph navigation/refetch, and
  records the `/ui/actions/execute` request. Component tests no longer write
  this artifact.
- **Resolved P1 — Android-only ownership:** `App` rejects every non-Android
  platform before mounting `DaemonProvider` or `AppNavigator`. iOS points to
  the native Apple client, Expo web reports the unsupported surface, and the
  regression test proves neither path initializes secure storage,
  notifications, push registration, SSE, or daemon UI.
- **Resolved P2 — source-size blocker:** the 419-line production-journey test is
  now a 274-line journey plus a 176-line reusable daemon/SSE fixture. The only
  remaining touched oversized files are pre-existing `DaemonContext.tsx` (130
  net added lines) and the workflow-runtime integration suite (16 net added
  lines); both stay below the 150-line substantial-growth threshold, and the
  two-warning batch stays below the four-file severe threshold. UI rendering,
  graph traversal, field handling, and presentation remain split into focused
  files under 300 lines.

The packaged audit and webapp-testing skill instructions were outside the run's readable filesystem, so this report records the equivalent repository-local checks instead.
