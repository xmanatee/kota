/**
 * Dynamic Playwright loader. Playwright is an optional peer — it stays out
 * of the project's required dependencies and is loaded only when a browser
 * tool runs. This module isolates the dynamic-import machinery so lifecycle
 * code has a single stable import, and so tests can mock `playwright` via
 * the standard `vi.mock` surface without fighting with TypeScript's resolver.
 */

export type PlaywrightBrowser = {
  isConnected(): boolean;
  newContext(options?: { storageState?: string }): Promise<PlaywrightContext>;
  close(): Promise<void>;
};

export type PlaywrightContext = {
  newPage(): Promise<PlaywrightPage>;
  storageState(options?: { path?: string }): Promise<unknown>;
  close(): Promise<void>;
};

export type PlaywrightElementHandle = {
  screenshot(options?: { type?: "png" | "jpeg" }): Promise<Buffer>;
  innerText(): Promise<string>;
};

export type PlaywrightPage = {
  goto(
    url: string,
    options?: { waitUntil?: string; timeout?: number },
  ): Promise<unknown>;
  waitForSelector(
    selector: string,
    options?: {
      timeout?: number;
      state?: "attached" | "visible" | "hidden" | "detached";
    },
  ): Promise<PlaywrightElementHandle | null>;
  title(): Promise<string>;
  url(): string;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  fill(
    selector: string,
    value: string,
    options?: { timeout?: number },
  ): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  screenshot(options?: {
    type?: "png" | "jpeg";
    fullPage?: boolean;
  }): Promise<Buffer>;
  isClosed(): boolean;
  close(): Promise<void>;
};

export type PlaywrightModule = {
  chromium: {
    launch(options?: { headless?: boolean }): Promise<PlaywrightBrowser>;
  };
};

export async function loadPlaywrightModule(): Promise<PlaywrightModule> {
  try {
    return (await (Function('return import("playwright")')() as Promise<unknown>)) as PlaywrightModule;
  } catch {
    throw new Error(
      "Playwright is not installed. Install it with: pnpm add playwright",
    );
  }
}
