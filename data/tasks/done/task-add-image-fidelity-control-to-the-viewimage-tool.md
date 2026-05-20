---
id: task-add-image-fidelity-control-to-the-viewimage-tool
title: Add image fidelity control to the view_image tool
status: done
priority: p2
area: modules
summary: Let callers request resized or original-resolution image reads through the system module's view_image tool so visual QA and screenshot inspection do not silently lose detail.
created_at: 2026-05-20T15:40:40.021Z
updated_at: 2026-05-20T16:22:58.835Z
---

## Problem

KOTA's `view_image` tool in `src/modules/system/view-image.ts` always runs
large images through a best-effort downscale path before returning the image
block. That default is useful for normal screenshots and photos, but it is
silent and caller-uncontrolled. Visual QA, chart inspection, dense UI
screenshots, small text, and generated-image review sometimes need the
original pixels; today the caller cannot request original resolution or tell
from the tool schema which fidelity path will be used.

The nearby GUI coordinate-scaling task covered actionable desktop screenshots,
but `view_image` is the general local-image analysis tool used outside that
coordinate contract. It still needs an explicit fidelity choice so image
inspection does not degrade evidence invisibly.

## Desired Outcome

`view_image` exposes a strict fidelity control at the tool boundary. Callers can
choose the conservative resized behavior or request original-resolution input,
and the tool result reports which path was used with enough metadata to make
visual evidence auditable.

## Constraints

- Keep the work in `src/modules/system/`; do not move image viewing back into
  core and do not add a parallel image tool.
- Preserve `view_image` as the public tool name. Tighten its schema and result
  metadata instead of adding an alias.
- Keep resized mode as the default unless a caller explicitly requests original
  fidelity.
- Continue enforcing file type and size limits. If original fidelity would
  exceed a provider or tool-result limit, fail loudly or require an explicit
  resized mode rather than silently falling back.
- Do not make the implementation depend on one harness's image budget. Any
  harness-specific limit should be represented as explicit metadata or a
  narrow adapter concern, not as an unlabelled system-module constant.
- Keep the tool cache correct: fidelity mode and any relevant sizing options
  must participate in cache keys naturally through the tool input.

## Done When

- `view_image` accepts an explicit fidelity option, such as `detail: "resized"`
  or `detail: "original"`, with a typed schema and focused validation.
- Resized mode keeps the current conservative behavior, while original mode
  returns the original file bytes when the file passes the declared safety
  limits.
- Tool output reports original dimensions, returned dimensions, byte size, and
  whether resizing occurred.
- Focused tests cover default resized behavior, explicit original fidelity, an
  oversized original failure, unsupported formats, and cache-key separation
  between fidelity modes.
- `src/modules/system/AGENTS.md` records the narrow contract if future system
  tools need to preserve image fidelity without inventing a second convention.

## Source / Intent

Explorer run `2026-05-20T15-40-40-021Z-explorer-bwltpk` reviewed an empty
actionable queue. The strategic blocked alternatives were still gated on
operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Add image fidelity control to the view_image tool" --state ready --area modules --priority p2 --summary "Let callers request resized or original-resolution image reads through the system module's view_image tool so visual QA and screenshot inspection do not silently lose detail."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed`. This file follows the normalized task schema manually.

External source checked:

- `https://github.com/openai/codex/releases` currently lists Codex `0.132.0`
  and names a concrete image-fidelity improvement: app-server turns preserve
  requested image fidelity, including original-resolution local images, across
  user inputs and image-producing tools.

Local evidence:

- `src/modules/system/view-image.ts` accepts only `path` and `description`.
- `tryResize` silently downsizes images wider than `MAX_DIM` before returning
  the image block, with no caller-facing fidelity option.
- `src/modules/tool-cache/cache.ts` caches `view_image` by the whole input
  object, so a schema-level fidelity option can keep cached resized and
  original reads separate without adding cache-specific hooks.

## Initiative

Reliable visual evidence: KOTA's image-observation tools should make fidelity
an explicit input/output contract before visual QA, UI inspection, and
generated-image review depend on their artifacts.

## Acceptance Evidence

- Focused system-module tests pass, for example:
  `pnpm test src/modules/system/view-image.test.ts src/modules/tool-cache/cache.test.ts`.
- Diff review shows one `view_image` fidelity contract, no duplicate image
  tool, no core migration, and no silent resize fallback when original
  fidelity is requested.
