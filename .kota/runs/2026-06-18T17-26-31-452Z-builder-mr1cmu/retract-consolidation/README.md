# Retract Consolidation Evidence

Committed acceptance evidence for `task-fan-out-consolidation-retract`.

The 2026-06-15 local promotion artifact was ignored by the repository run
rules, so this directory carries the reviewable copy in the current builder run.

Rendered per-surface evidence:

- `rendered-evidence/web/retract-panel-operator-states.html` and
  `rendered-evidence/web/retract-panel-operator-states.json`
- `rendered-evidence/mobile/retract-screen-rendered-tree-manifest.json`
  plus the per-state `rendered-evidence/mobile/retract-screen-*.json`
  tree fixtures
- `rendered-evidence/macos/rendered-menu-bar-states.txt`
- `rendered-evidence/macos/swift-client-tests.txt`
- `rendered-evidence/telegram/chat-rendered-replies.txt`
- `rendered-evidence/slack/chat-rendered-replies.txt`

The web artifact is a rendered HTML snapshot fixture generated from the real
`RetractPanel` component after driving the confirmation flow for the success,
`no_contributors`, `not_found`, and `contributor_failed` arms. Chromium and
Quick Look screenshot capture are blocked by the local macOS sandbox in this
repair run, so no PNG is claimed.

The mobile artifacts are React Native rendered tree snapshot fixtures generated
from the real `RetractScreen` across confirmation, success, unavailable,
not-found, contributor-failed, and offline states.

Contract evidence:

- `contract-validation-results.txt`
