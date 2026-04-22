# Browser Module

This module provides headless browser automation tools via Playwright, plus
scoped content-ingest tools for auth-walled and JS-gated sources.

- Tools are in the `browser` group for progressive disclosure.
- All interactive tools are classified as `dangerous` risk since they execute
  page-side JS and can trigger external side effects. `browser_close` is `safe`.
- Playwright is lazy-imported at first use via `playwright-loader.ts`. The
  module loads cleanly without Playwright installed and logs a warning.
- A single browser + context + page is reused across tool calls and closed on
  idle timeout or session cleanup.
- Do not add Playwright to the project's required dependencies. It stays as
  an optional peer that operators install when they need browser capability.

## Authenticated Browser Profile

Operators configure a persistent login session via `modules.browser`:

```jsonc
{
  "modules": {
    "browser": {
      "storageStatePath": "path/to/x-profile.json",
      "persistProfile": false
    }
  }
}
```

- `storageStatePath` points at a Playwright [`storageState`](https://playwright.dev/docs/auth)
  JSON file containing cookies and localStorage for an authenticated session.
  Relative paths resolve against the project directory. If the file exists,
  every browser context is created with it loaded; if it does not, the module
  falls back to an ephemeral context.
- `persistProfile: true` writes the current context's state back to the same
  path on idle close. Operators use this to capture a fresh login (run once
  with `persistProfile: true`, log in interactively, then pin the file in
  their secrets surface with `persistProfile: false`).
- The storageState file is outside repo source — never check it in. KOTA's
  secrets surface is the right home; the path is the configuration knob.
- The profile is shared across `browser_navigate`, `browser_get_text`,
  `x_post_read`, `rendered_article_read`, and every other browser tool in
  this module.

## Content-Ingest Tools

- `browser_get_text` — raw `innerText` extraction of a page or element. Use
  it for ad-hoc inspection of already-navigated pages.
- `x_post_read` — scoped X/Twitter status reader. Navigates, waits for the
  tweet article, and returns post body + author + up to `max_replies` reply
  texts. Requires an authenticated profile for posts behind the X auth wall;
  without one the tool returns a typed failure ("redirected to X login" or
  "X displayed an auth-wall / login prompt"). X scraping outside of normal
  reading volumes is discouraged; this tool is intentionally narrow to one
  post per call.
- `rendered_article_read` — JS-gated article reader. Navigates, waits for
  network idle, and extracts `<article>`/`<main>` text (or a caller-supplied
  selector, or `document.body` fallback). Returns a typed failure for
  Cloudflare/JS challenges that never clear. Intended for pages like
  `openai.com/index/*` that reject plain HTTP fetches.

All three content-ingest tools are included in
`DEFAULT_TARGET_TOOLS` for the `injection-defense` middleware, so autonomous
runs see the standard "BEGIN UNTRUSTED CONTENT" annotation on suspicious
payloads.

## Failure Modes

- Missing Playwright → the tool runner throws the same "Playwright is not
  installed" error path the interactive tools use.
- Missing profile for auth-walled content → typed failure explaining the
  configuration knob the operator needs to set.
- JS challenge still present after network idle → typed failure naming the
  gate so the caller can back off or route to a different tool.
- Navigation / extract timeout → typed failure with the observed timeout
  value so callers can decide whether to retry.

## Extending

- New content-ingest tools should be added to `DEFAULT_TARGET_TOOLS` in
  `src/modules/injection-defense/defense-middleware.ts`. Browser-driven text
  extraction carries the same injection risk as `web_fetch`.
- Scoped-site tools (future: Discord, LinkedIn, GitHub-private) follow the
  `x_post_read` shape — a narrow `*_read` tool with a URL whitelist regex,
  auth-gate detection, structured extraction, and a typed failure envelope.
  Do not generalise into a god-tool until a second scoped site lands.
- Vendor TOS: if a scoped tool reads a source whose terms forbid automated
  access, document it in the tool's description and route through operator
  approval, not the autonomy default.
