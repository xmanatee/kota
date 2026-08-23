import type { BrowserProfileOptions } from "./browser-profile.js";
import {
  type BrowserNetworkProxy,
  startBrowserNetworkProxy,
} from "./network-proxy.js";
import {
  loadPlaywrightModule,
  type PlaywrightBrowser,
  type PlaywrightModule,
} from "./playwright-loader.js";

let pw: PlaywrightModule | null = null;
let browser: PlaywrightBrowser | null = null;
let browserLaunch: Promise<PlaywrightBrowser> | null = null;
let browserClose: Promise<void> | null = null;
let networkProxy: BrowserNetworkProxy | null = null;

async function ensurePlaywright(): Promise<PlaywrightModule> {
  if (pw) return pw;
  pw = await loadPlaywrightModule();
  return pw;
}

export async function ensureBrowserProcess(
  options: BrowserProfileOptions,
): Promise<PlaywrightBrowser> {
  if (browserClose) await browserClose;
  if (browser?.isConnected()) return browser;
  if (browserLaunch) return browserLaunch;

  browserLaunch = (async () => {
    const playwright = await ensurePlaywright();
    const proxy = await startBrowserNetworkProxy({
      profile: options.networkProfile,
    });
    try {
      const launched = await playwright.chromium.launch({
        headless: options.headless,
        args: ["--proxy-bypass-list=<-loopback>"],
        proxy: {
          server: proxy.server,
          username: proxy.username,
          password: proxy.password,
        },
      });
      browser = launched;
      networkProxy = proxy;
      return launched;
    } catch (error) {
      await proxy.close().catch(() => {});
      throw error;
    }
  })();

  try {
    return await browserLaunch;
  } finally {
    browserLaunch = null;
  }
}

export async function closeBrowserProcess(): Promise<void> {
  if (browserLaunch) await browserLaunch.catch(() => {});
  if (browserClose) return browserClose;

  const activeBrowser = browser;
  const activeProxy = networkProxy;
  browser = null;
  networkProxy = null;
  pw = null;
  browserClose = (async () => {
    await activeBrowser?.close().catch(() => {});
    await activeProxy?.close().catch(() => {});
  })();
  try {
    await browserClose;
  } finally {
    browserClose = null;
  }
}
