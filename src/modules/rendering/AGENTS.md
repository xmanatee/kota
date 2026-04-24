# Rendering Module

Typed terminal rendering for KOTA. Every operator-facing surface routes
through this module instead of writing raw ANSI or hand-rolled padding
to a stream.

## Inverted Seam

Core does not import `#modules/rendering/*`. The module registers a
`RenderingProvider` during `onLoad` that supplies the default
`CliTransport` and `ReplChrome`. Core callers (loop constructor, REPL
host) resolve them through `getRenderingProvider()` in
`#core/modules/provider-registry.js`; protocol types
(`RenderingProvider`, `ReplChrome`) live in
`#core/modules/provider-types.js`. Deployments that omit this module
degrade to `NullTransport` for the agent stream; the interactive REPL
refuses to start without a chrome. The repo-wide import guard
`src/core/agent-harness/no-module-imports-in-core.test.ts` enforces the
boundary for every `#modules/*` subpath.

## Vocabulary

Primitives are a discriminated union. Surfaces describe *what* they want
to show; the renderer decides how the current theme, width, and TTY
state paint it. New primitives extend the union rather than smuggling
raw strings through an escape hatch.

Today's primitives cover lines and text spans, headings, separators,
blanks, stacks, key/value blocks, status banners, lists, panels, tool
calls, agent messages, diffs, and JSON. A surface that cannot be modeled
with the current vocabulary adds the missing primitive here — it does
not reach around the module with a raw `console.log`.

Surfaces that emit structured output (JSON streams, machine-parseable
payloads) do not render through this module. Those stay on their own
typed I/O path; the module is for human-facing terminal output only.

## Transport

The terminal transport owns theme detection, width detection, and the
pipe-vs-TTY split. Callers pass a `RenderNode` to `print` or build a
transport explicitly when they need stderr, a buffered writer, or a
custom theme.

Environment contract:

- A non-TTY stream resolves to the `no-color` theme with a safe fallback
  width, so piped output and CI logs stay machine-parseable.
- `NO_COLOR=1` forces the `no-color` theme even on a TTY.
- `KOTA_RENDERER_THEME=ascii` forces ASCII icons for terminals that do
  not render the default Unicode glyphs.
- `KOTA_RENDERER_THEME=no-color` forces the `no-color` theme.

Themes are declarative mappings from semantic role and status kind to
ANSI SGR codes, icons, and label strings. Add a theme by filling in the
same shape; never branch on theme name at a call site.

## Pure Renderer

`render(node, ctx)` is pure. It takes a node plus a `RenderContext`
(theme, width, indent) and returns the exact string the transport would
write. Unit tests assert the rendered tree without touching a real TTY,
and surfaces that still depend on string return values continue to work
while migration is in flight.

## Migration Pattern

When migrating a surface:

1. Build a `RenderNode` from the surface's typed data (a function whose
   only inputs are domain values and whose only output is a node).
2. Surface the node through `print` for CLI entry points, or through
   `renderToString` when another string consumer reads the result.
3. Delete any local padding, ANSI, or width code the surface no longer
   needs. Do not keep both paths.
4. If a test asserted specific whitespace, loosen it to match the
   primitive — alignment invariants belong in the renderer's unit tests,
   not in downstream output checks.

Do not introduce a second rendering DSL, a parallel theme object, or a
per-surface color palette. All of those go here.
