---
id: task-add-a-gui-screenshot-coordinate-scaling-contract-for
title: Add a GUI screenshot coordinate-scaling contract for computer use
status: done
priority: p2
area: modules
summary: Make screenshot output and computer_use coordinates share an explicit display-to-native scaling contract so GUI automation does not silently click in the wrong coordinate space after image resizing.
created_at: 2026-05-16T05:15:30.000Z
updated_at: 2026-05-16T05:26:39.000Z
---

## Problem

KOTA's execution module has two GUI primitives that are meant to work together:
`screenshot` shows the agent the screen and `computer_use` acts on x/y
coordinates. The screenshot tool currently downscales captured images by width
only, returns an image block and a human-readable size line, and drops the
coordinate transform that connects the displayed image back to native screen
coordinates. `computer_use` then accepts raw coordinates with no way to know
whether the model is supplying native screen coordinates or coordinates from
the resized screenshot it just saw.

This is most risky on high-DPI and large displays. A screenshot may be resized
before the model sees it, while the operating-system click API still expects
native screen coordinates. That can make GUI automation look nondeterministic:
the model points at the right visual target in the screenshot but the runtime
clicks a scaled or offset location.

## Desired Outcome

The execution module exposes an explicit screenshot-to-computer-use coordinate
contract. Every screenshot that is suitable for follow-up GUI actions should
name the native capture size, displayed image size, scale factors, and the
coordinate space expected by `computer_use`. The action runner should convert
or reject coordinates deliberately instead of relying on a silent assumption.

## Constraints

- Keep this in the module-owned execution/browser capability boundary. Do not
  move GUI tools back into core.
- Do not add a vendor-specific computer-use dependency, a browser automation
  dependency, a new UI/client surface, or a network provider.
- Preserve the existing `screenshot` and `computer_use` tool names. Tighten the
  contract through typed inputs/outputs and clear error messages, not aliases.
- Do not make Claude-specific constants the only source of truth. A
  conservative default is fine, but model/harness-specific display budgets
  should be explicit if they are introduced.
- Full-page browser screenshots and element screenshots must not be treated as
  native desktop coordinate maps unless the implementation can prove the
  transform. If they are not actionable, say so in the tool result.

## Done When

- `screenshot` records and returns the native capture dimensions, displayed
  image dimensions, and scale factors after resizing. The returned text is
  concise but gives the agent enough information to map screenshot coordinates
  to native coordinates.
- `computer_use` accepts an explicit coordinate-space choice for coordinate
  actions, such as native coordinates versus coordinates measured against the
  last screenshot display size. Invalid or ambiguous inputs fail loudly.
- Coordinate conversion is centralized in one small helper with focused tests
  covering native passthrough, display-to-native conversion, fractional scale
  rounding, high-DPI style dimensions, and malformed dimensions.
- Screenshot resizing respects both a maximum long edge and a maximum pixel
  budget, preserves aspect ratio, and never upscales beyond the native capture.
- The GUI tool descriptions and `src/modules/execution/AGENTS.md` describe the
  contract narrowly enough that future browser, desktop, or visual QA work does
  not invent a second coordinate convention.
- Existing screenshot and computer-use tests are updated without weakening the
  high-risk tool classification or adding test-only production flags.

## Source / Intent

Explorer run `2026-05-16T05-13-16-424Z-explorer-4aw0mx` reviewed the empty
queue. The strategic blocked alternatives exposed by `inspect-queue` are all
operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

Several recent watchlist signals were already converted into done tasks today:
Codex reconnectable daemon-client probing, Goose protocol-message observation
summaries, LiveKit realtime voice lifecycle, and shipped-preset pricing
coverage.

The remaining nonduplicative signal came from Anthropic's May 13, 2026
computer/browser-use guidance: screenshot dimensions, downscaling limits,
content ordering, and coordinate scaling materially affect click accuracy. KOTA
should not copy Claude's API shape, but it does need the same architectural
property: the image shown to the model and the coordinates sent to the OS must
share an explicit transform.

Sources checked:

- `https://claude.com/blog`
- `https://claude.com/blog/best-practices-for-computer-and-browser-use-with-claude`
- `src/modules/execution/screenshot.ts`
- `src/modules/execution/computer-use.ts`
- `src/modules/browser/tools.ts`

The `pnpm kota task create` scaffold command was attempted first but failed in
this run with `Fatal: fetch failed`, so this task was hand-scaffolded to match
the normalized task schema.

## Initiative

Reliable GUI automation: KOTA's visual observation and GUI action primitives
should form one strict protocol before higher-level computer-use, browser-use,
or rendered-evidence workflows depend on them.

## Acceptance Evidence

- Test transcript for focused execution-module coverage, for example
  `pnpm test src/modules/execution/screenshot.test.ts src/modules/execution/computer-use.test.ts`.
- If browser screenshots are included in the actionable-coordinate contract,
  include the focused browser-module test transcript as well.
- Diff review shows one coordinate-scaling helper, no new GUI vendor
  dependency, no new client surface, and no second coordinate convention in
  browser or execution tools.
