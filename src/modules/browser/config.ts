import { isAbsolute, resolve } from "node:path";

export type BrowserModuleConfig = {
  /**
   * Path to a Playwright `storageState` JSON file. When present, the
   * browser context is created with this persisted cookie/localStorage
   * snapshot so authenticated sites recognise the session. Relative paths
   * are resolved against the project directory. The file is optional -
   * absence falls back to an ephemeral context.
   */
  storageStatePath?: string;
  /**
   * When true, persist the current context's storage state back to
   * `storageStatePath` on idle close. Operators can use this to capture
   * a fresh login before pinning the file in their secrets/config surface.
   */
  persistProfile?: boolean;
  /**
   * Whether Playwright should launch Chromium in headless mode. Defaults to
   * true. Operators can set this to false for source-access captures where a
   * vendor rejects headless browser automation but allows an ordinary headed
   * browser session.
   */
  headless?: boolean;
};

export type RawBrowserModuleConfig =
  | BrowserModuleConfig
  | object
  | undefined;

export type ResolvedBrowserProfileConfig = {
  storageStatePath: string | null;
  persist: boolean;
  headless: boolean;
};

export function resolveBrowserProfileConfig(
  raw: RawBrowserModuleConfig,
): ResolvedBrowserProfileConfig {
  return {
    storageStatePath: readStorageStatePath(raw),
    persist: readPersistProfile(raw),
    headless: readHeadless(raw),
  };
}

function readStorageStatePath(raw: RawBrowserModuleConfig): string | null {
  if (!raw || !("storageStatePath" in raw)) return null;
  const value = raw.storageStatePath;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readPersistProfile(raw: RawBrowserModuleConfig): boolean {
  if (!raw || !("persistProfile" in raw)) return false;
  return raw.persistProfile === true;
}

function readHeadless(raw: RawBrowserModuleConfig): boolean {
  if (!raw || !("headless" in raw)) return true;
  return raw.headless !== false;
}

export function resolveStorageStatePath(
  configuredPath: string | null,
  projectDir: string,
): string | null {
  if (!configuredPath) return null;
  if (isAbsolute(configuredPath)) return configuredPath;
  return resolve(projectDir, configuredPath);
}
