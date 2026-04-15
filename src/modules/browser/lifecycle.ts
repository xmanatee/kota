interface PlaywrightBrowser {
  isConnected(): boolean;
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightElementHandle {
  screenshot(options?: { type?: "png" | "jpeg" }): Promise<Buffer>;
  innerText(): Promise<string>;
}

interface PlaywrightPage {
  goto(
    url: string,
    options?: { waitUntil?: string; timeout?: number },
  ): Promise<unknown>;
  waitForSelector(
    selector: string,
    options?: { timeout?: number },
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
}

interface PlaywrightModule {
  chromium: {
    launch(options?: { headless?: boolean }): Promise<PlaywrightBrowser>;
  };
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

let pw: PlaywrightModule | null = null;
let browser: PlaywrightBrowser | null = null;
let page: PlaywrightPage | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

async function loadPlaywright(): Promise<PlaywrightModule> {
  if (pw) return pw;
  try {
    // Dynamic import — Playwright is optional; types are structural above
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pw = (await (Function('return import("playwright")')() as Promise<unknown>)) as PlaywrightModule;
    return pw;
  } catch {
    throw new Error(
      "Playwright is not installed. Install it with: pnpm add playwright",
    );
  }
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeBrowser(), IDLE_TIMEOUT_MS);
}

export async function getPage(): Promise<PlaywrightPage> {
  const playwright = await loadPlaywright();
  if (!browser || !browser.isConnected()) {
    browser = await playwright.chromium.launch({ headless: true });
  }
  if (!page || page.isClosed()) {
    page = await browser.newPage();
  }
  resetIdleTimer();
  return page;
}

export async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (page && !page.isClosed()) {
    await page.close().catch(() => {});
  }
  page = null;
  if (browser) {
    await browser.close().catch(() => {});
  }
  browser = null;
}

export function isPlaywrightAvailable(): boolean {
  try {
    require.resolve("playwright");
    return true;
  } catch {
    return false;
  }
}
