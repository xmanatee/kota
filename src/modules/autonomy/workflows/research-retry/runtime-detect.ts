import { createRequire } from "node:module";
import { loadConfig } from "#core/config/config.js";

const requireFromHere = createRequire(import.meta.url);

/**
 * Cheap dynamic-import probe for Playwright. Mirrors the browser module's
 * own availability check but avoids a runtime cross-module import so this
 * workflow does not need a hard `browser` module dependency just to detect
 * "Playwright not installed."
 *
 * Lives in its own file so tests can `vi.mock` this surface without
 * stubbing the larger precondition module.
 */
export function isPlaywrightAvailable(): boolean {
  try {
    requireFromHere.resolve("playwright");
    return true;
  } catch {
    return false;
  }
}

type BrowserModuleConfig = {
  storageStatePath?: string;
  persistProfile?: boolean;
};

/**
 * Read the project's `modules.browser` config layer for the storage-state
 * profile path. Returns an empty object when the layer is absent — the
 * caller decides what "no profile configured" means for skip evaluation.
 */
export function readBrowserConfig(projectDir: string): BrowserModuleConfig {
  const config = loadConfig(projectDir);
  const raw = config.modules?.browser;
  if (!raw || typeof raw !== "object") return {};
  return raw as BrowserModuleConfig;
}
