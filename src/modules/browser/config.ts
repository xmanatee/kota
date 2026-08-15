import { isAbsolute, resolve } from "node:path";
import {
  OUTBOUND_HTTP_PROFILES,
  type OutboundHttpProfile,
} from "#core/outbound-http/index.js";

export type BrowserNetworkProfileConfig =
  | { name: "public-untrusted" }
  | { name: "configured-provider"; allowedOrigins: string[] };

export type BrowserNetworkProfile = Extract<
  OutboundHttpProfile,
  { readonly name: "public-untrusted" | "configured-provider" }
>;

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
  /**
   * Network boundary applied to every Chromium request. Absence selects the
   * public-untrusted profile. Private targets are available only when an
   * operator explicitly selects configured-provider and lists each origin.
   */
  networkProfile?: BrowserNetworkProfileConfig;
};

export type RawBrowserModuleConfig =
  | BrowserModuleConfig
  | object
  | undefined;

export type ResolvedBrowserProfileConfig = {
  storageStatePath: string | null;
  persist: boolean;
  headless: boolean;
  networkProfile: BrowserNetworkProfile;
};

export function resolveBrowserProfileConfig(
  raw: RawBrowserModuleConfig,
): ResolvedBrowserProfileConfig {
  return {
    storageStatePath: readStorageStatePath(raw),
    persist: readPersistProfile(raw),
    headless: readHeadless(raw),
    networkProfile: readNetworkProfile(raw),
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

function readNetworkProfile(raw: RawBrowserModuleConfig): BrowserNetworkProfile {
  if (!raw || !("networkProfile" in raw) || raw.networkProfile === undefined) {
    return OUTBOUND_HTTP_PROFILES.publicUntrusted;
  }
  const configured = raw.networkProfile;
  if (!configured || typeof configured !== "object" || !("name" in configured)) {
    throw new TypeError(
      "modules.browser.networkProfile must select public-untrusted or configured-provider",
    );
  }
  if (configured.name === "public-untrusted") {
    return OUTBOUND_HTTP_PROFILES.publicUntrusted;
  }
  if (
    configured.name !== "configured-provider" ||
    !("allowedOrigins" in configured) ||
    !Array.isArray(configured.allowedOrigins) ||
    configured.allowedOrigins.some((origin) => typeof origin !== "string")
  ) {
    throw new TypeError(
      "modules.browser.networkProfile configured-provider requires an allowedOrigins string array",
    );
  }
  const profile = OUTBOUND_HTTP_PROFILES.configuredProvider(
    configured.allowedOrigins,
  );
  if (profile.name !== "configured-provider") {
    throw new TypeError("configured browser network profile did not resolve");
  }
  return profile;
}

export function resolveStorageStatePath(
  configuredPath: string | null,
  projectDir: string,
): string | null {
  if (!configuredPath) return null;
  if (isAbsolute(configuredPath)) return configuredPath;
  return resolve(projectDir, configuredPath);
}
