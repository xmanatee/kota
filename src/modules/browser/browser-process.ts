import type { BrowserProfileOptions } from "./browser-profile.js";
import { startBrowserNetworkProxy } from "./network-proxy.js";
import { loadPlaywrightModule, type PlaywrightBrowser } from "./playwright-loader.js";

export type BrowserProcess = {
  browser: PlaywrightBrowser;
  close(): Promise<void>;
};

/** A session owns both Chromium and its immutable connection policy. */
export async function launchBrowserProcess(
  options: BrowserProfileOptions,
): Promise<BrowserProcess> {
  const playwright = await loadPlaywrightModule();
  const proxy = await startBrowserNetworkProxy({
    profile: options.networkProfile,
  });
  try {
    const browser = await playwright.chromium.launch({
      headless: options.headless,
      args: ["--proxy-bypass-list=<-loopback>"],
      proxy: {
        server: proxy.server,
        username: proxy.username,
        password: proxy.password,
      },
    });
    return {
      browser,
      async close() {
        await browser.close().catch(() => {});
        await proxy.close().catch(() => {});
      },
    };
  } catch (error) {
    await proxy.close().catch(() => {});
    throw error;
  }
}
