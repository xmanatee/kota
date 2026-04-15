# Web Client

React app built with Vite, TanStack Router, TanStack Query, Tailwind CSS, and shadcn/ui.

- Consumes only the daemon HTTP+JSON API and SSE event stream.
- No direct `.kota/` file access.
- Build output (`dist/`) is served by the daemon's HTTP server.
- Run `pnpm build` to produce the static assets before starting the daemon.
- During development, `pnpm dev` starts a Vite dev server that proxies API requests to `http://127.0.0.1:3000`.
