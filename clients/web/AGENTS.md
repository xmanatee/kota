# Web Client

React app built with Vite, TanStack Query, Tailwind CSS, and shadcn/ui.

- Consumes only the daemon HTTP+JSON API and SSE event stream.
- No direct `.kota/` file access.
- Build output (`dist/`) is served by the daemon's HTTP server.
- Run `pnpm build` to produce the static assets before starting the daemon.
- During development, `pnpm dev` starts a Vite dev server that proxies API requests to `http://127.0.0.1:3000`.
- Voice goes through `/api/voice/transcribe` and `/api/voice/synthesize` —
  never through a vendor SDK in the browser. Microphone capture uses
  `MediaRecorder`; playback uses `HTMLAudioElement`. Surface the daemon's
  typed failure codes (`stt-unavailable`, `tts-unavailable`,
  `tts-format-unsupported`) one-to-one in the UI so operators learn the same
  vocabulary the CLI uses.

## Directory-Scope Routes And Queries

The daemon hosts one or more directory-scope runtimes. The web client still
uses project-named context and route prefixes as its compatibility adapter, but
new scope-aware surfaces should consume the daemon's `ScopeRegistryProjection`
from `/scopes`.

- The active project lives in `ProjectContext` (`src/lib/project-context.tsx`)
  and is encoded into the URL hash as `#p/<projectId>/<sub-route>`. The
  `p/<projectId>` prefix is owned by the context; everything after the second
  `/` is in-project state (run id, compare ids, history id) that views own.
  Hash-based routing is the convention here — no client-side router library.
- Every directory-scope TanStack Query key starts with the projectId
  (`["sessions", projectId]`, `["workflowRuns", projectId, params]`, …) so
  the cache cannot leak rows across scopes by construction. Keys are
  produced by the factories in `src/api/queries.ts`; mirror that shape when
  adding a new query rather than inventing a parallel key form.
- Scoped routes call `api.<x>(projectId, …)` (from
  `src/api/client.ts`), which appends the compatibility `?projectId=<id>` to
  the daemon path. Routes that the daemon has not yet scoped (e.g. `/api/attention`,
  `/api/digest`, `/api/memory`) still take a `projectId` at the query-key
  layer so cache isolation remains airtight; their underlying URL stays
  global until daemon-side scope attribution lands.
- The header `ProjectSelector` (`src/components/sidebar/ProjectSelector.tsx`)
  hides itself when the projection has exactly one project, so the
  KOTA-on-itself experience is unchanged.
- SSE invalidation in `useDaemonEvents` reads the active projectId and
  invalidates that project's keys. The selector's reactive `projectId`
  drives both the query keys and the SSE subscription set, so switching
  projects re-fetches every project-scoped panel and never bleeds rows from
  the previous selection.
- Tests render directory-scoped components inside `<TestProjectProvider>`
  (also in `src/lib/project-context.tsx`) instead of stubbing a fake
  identity payload through `fetch`.
