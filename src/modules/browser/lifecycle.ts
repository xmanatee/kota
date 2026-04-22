import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  loadPlaywrightModule,
  type PlaywrightBrowser,
  type PlaywrightContext,
  type PlaywrightModule,
  type PlaywrightPage,
} from "./playwright-loader.js";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

let pw: PlaywrightModule | null = null;
let browser: PlaywrightBrowser | null = null;
let context: PlaywrightContext | null = null;
let page: PlaywrightPage | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Resolved profile options for an authenticated browser context. The
 * `storageStatePath` is where Playwright loads cookies/localStorage from
 * (if the file exists) and where the module can persist state back to.
 * When `persist` is true, the context's storage is written back to the
 * same path on idle close so a fresh login stays durable across runs.
 */
export type BrowserProfileOptions = {
  storageStatePath: string | null;
  persist: boolean;
};

let profile: BrowserProfileOptions = {
  storageStatePath: null,
  persist: false,
};

/**
 * Configure the persistent browser profile. Called from the module's
 * `onLoad` with values resolved from `modules.browser` config. Absence
 * of a profile path keeps the default ephemeral context.
 */
export function configureBrowserProfile(options: BrowserProfileOptions): void {
  profile = options;
}

export function getConfiguredBrowserProfile(): BrowserProfileOptions {
  return profile;
}

async function ensurePlaywright(): Promise<PlaywrightModule> {
  if (pw) return pw;
  pw = await loadPlaywrightModule();
  return pw;
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeBrowser(), IDLE_TIMEOUT_MS);
}

function resolveStoragePath(projectDir: string | null): string | null {
  const configured = profile.storageStatePath;
  if (!configured) return null;
  if (isAbsolute(configured)) return configured;
  const base = projectDir ?? process.cwd();
  return resolve(base, configured);
}

async function ensureContext(): Promise<PlaywrightContext> {
  if (context) return context;
  const playwright = await ensurePlaywright();
  if (!browser || !browser.isConnected()) {
    browser = await playwright.chromium.launch({ headless: true });
  }
  const storagePath = resolveStoragePath(null);
  const options: { storageState?: string } = {};
  if (storagePath && existsSync(storagePath)) {
    options.storageState = storagePath;
  }
  context = await browser.newContext(options);
  return context;
}

export async function getPage(): Promise<PlaywrightPage> {
  const ctx = await ensureContext();
  if (!page || page.isClosed()) {
    page = await ctx.newPage();
  }
  resetIdleTimer();
  return page;
}

/**
 * Persist the current browser context's storage state to the configured
 * path. Only invoked when the operator has explicitly enabled persistence
 * (`modules.browser.persistProfile`). No-op when no profile is configured
 * or persist is disabled.
 */
export async function persistBrowserProfile(): Promise<void> {
  if (!profile.persist || !profile.storageStatePath) return;
  if (!context) return;
  const resolved = resolveStoragePath(null);
  if (!resolved) return;
  const dir = dirname(resolved);
  if (!existsSync(dir)) {
    throw new Error(
      `Cannot persist browser profile: directory does not exist: ${dir}. ` +
        "Create it explicitly or point storageStatePath at an existing location.",
    );
  }
  await context.storageState({ path: resolved });
}

export async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  await persistBrowserProfile().catch(() => {});
  if (page && !page.isClosed()) {
    await page.close().catch(() => {});
  }
  page = null;
  if (context) {
    await context.close().catch(() => {});
  }
  context = null;
  if (browser) {
    await browser.close().catch(() => {});
  }
  browser = null;
  pw = null;
}

export function isPlaywrightAvailable(): boolean {
  try {
    require.resolve("playwright");
    return true;
  } catch {
    return false;
  }
}
