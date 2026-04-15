# Browser Module

This module provides headless browser automation tools via Playwright.

- Tools are in the `browser` group for progressive disclosure.
- All interactive tools are classified as `dangerous` risk since they execute
  page-side JS and can trigger external side effects.
- Playwright is lazy-imported at first use. The module loads cleanly without
  Playwright installed and logs a warning.
- A single browser instance is reused across tool calls and closed on idle
  timeout or session cleanup.
- Do not add Playwright to the project's required dependencies. It stays as an
  optional peer that operators install when they need browser capability.
