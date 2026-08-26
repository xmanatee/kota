/**
 * Secrets management — provider-based secret storage with output masking.
 *
 * Secrets are resolved through a provider chain (scope file → global file → env → keychain).
 * Each canonical scope directory owns one stable store. Known values from
 * every registered store are masked before tool output reaches an agent.
 */

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  EnvProvider,
  escapeRegex,
  FileProvider,
  KeychainProvider,
} from "./secret-providers.js";

export type { SecretProvider } from "./secret-providers.js";
export { EnvProvider, FileProvider, KeychainProvider } from "./secret-providers.js";

export type SecretScope = "scope" | "global";

const GLOBAL_DIR = join(homedir(), ".kota");
const SCOPE_DIR = ".kota";
const SECRETS_FILE = "secrets.json";
const globalFileProviders = new Map<string, FileProvider>();
const scopeSecretStores = new Map<string, SecretStore>();

export type SecretStoreOptions = {
  globalDir: string;
};

function canonicalizeTrustedRoot(path: string): string {
  let existingPath = resolve(path);
  const missingComponents: string[] = [];
  while (!existsSync(existingPath)) {
    const parent = dirname(existingPath);
    if (parent === existingPath) break;
    missingComponents.unshift(basename(existingPath));
    existingPath = parent;
  }
  return join(realpathSync.native(existingPath), ...missingComponents);
}

function canonicalizeStorageDirectoryParent(path: string): string {
  const absolutePath = resolve(path);
  const parent = dirname(absolutePath);
  if (parent === absolutePath) return canonicalizeTrustedRoot(absolutePath);
  return join(canonicalizeTrustedRoot(parent), basename(absolutePath));
}

function globalFileProvider(globalDir: string): FileProvider {
  const path = join(globalDir, SECRETS_FILE);
  const existing = globalFileProviders.get(path);
  if (existing) return existing;
  const provider = new FileProvider(path, "global-file");
  globalFileProviders.set(path, provider);
  return provider;
}

export class SecretStore {
  private providers: (EnvProvider | FileProvider | KeychainProvider)[];
  private scopeFileProvider: FileProvider;
  private globalFileProvider: FileProvider;
  /** Cached known values for masking — maps value → name. */
  private knownSecrets = new Map<string, string>();
  private maskRegex: RegExp | null = null;

  constructor(cwd?: string, options?: SecretStoreOptions) {
    const scopeRoot = canonicalizeTrustedRoot(cwd || process.cwd());
    const globalDir = canonicalizeStorageDirectoryParent(
      options?.globalDir ?? GLOBAL_DIR,
    );

    this.scopeFileProvider = new FileProvider(
      join(scopeRoot, SCOPE_DIR, SECRETS_FILE),
      "scope-file",
    );
    this.globalFileProvider = globalFileProvider(globalDir);

    const scopeEnv = new EnvProvider(join(scopeRoot, ".env"));
    const globalEnv = new EnvProvider(join(globalDir, ".env"));
    const keychain = new KeychainProvider();

    // Provider chain: scope file → global file → scope .env → global .env → keychain
    this.providers = [
      this.scopeFileProvider,
      this.globalFileProvider,
      scopeEnv,
      globalEnv,
      keychain,
    ];

    this.refreshKnownSecrets();
  }

  /** Resolve a secret by walking the provider chain. */
  get(key: string): string | null {
    for (const provider of this.providers) {
      let value: string | null;
      try {
        value = provider.get(key);
      } catch {
        continue;
      }
      if (value !== null) {
        this.trackSecret(key, value);
        return value;
      }
    }
    return null;
  }

  /** Store a secret in the specified scope. */
  set(key: string, value: string, scope: SecretScope = "scope"): void {
    const provider = scope === "global" ? this.globalFileProvider : this.scopeFileProvider;
    provider.set(key, value);
    this.trackSecret(key, value);
  }

  /** Remove a secret from the specified scope. */
  remove(key: string, scope: SecretScope = "scope"): boolean {
    const provider = scope === "global" ? this.globalFileProvider : this.scopeFileProvider;
    const removed = provider.remove(key);
    if (removed) {
      for (const [value, name] of this.knownSecrets) {
        if (name === key) {
          this.knownSecrets.delete(value);
          break;
        }
      }
      this.maskRegex = null;
    }
    return removed;
  }

  /** List all known secret names across all providers. */
  list(): { name: string; source: string }[] {
    const seen = new Set<string>();
    const results: { name: string; source: string }[] = [];
    for (const provider of this.providers) {
      let names: string[];
      try {
        names = provider.list();
      } catch {
        continue;
      }
      for (const name of names) {
        if (!seen.has(name)) {
          seen.add(name);
          results.push({ name, source: provider.name });
        }
      }
    }
    return results;
  }

  /**
   * Mask all known secret values in the given text.
   * Returns the text with secret values replaced by `<secret:NAME>`.
   */
  mask(text: string): string {
    if (this.knownSecrets.size === 0) return text;
    const regex = this.getMaskRegex();
    if (!regex) return text;
    return text.replace(regex, (match) => {
      const name = this.knownSecrets.get(match);
      return name ? `<secret:${name}>` : "<secret:***>";
    });
  }

  /** Get the count of known secret values (for diagnostics). */
  getKnownCount(): number {
    return this.knownSecrets.size;
  }

  private trackSecret(name: string, value: string): void {
    if (value.length < 4) return;
    if (this.knownSecrets.get(value) === name) return;
    this.knownSecrets.set(value, name);
    this.maskRegex = null;
  }

  private getMaskRegex(): RegExp | null {
    if (this.maskRegex) return this.maskRegex;
    if (this.knownSecrets.size === 0) return null;

    const values = [...this.knownSecrets.keys()]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegex);

    this.maskRegex = new RegExp(values.join("|"), "g");
    return this.maskRegex;
  }

  private refreshKnownSecrets(): void {
    for (const provider of this.providers) {
      let names: string[];
      try {
        names = provider.list();
      } catch {
        continue;
      }
      for (const name of names) {
        try {
          const value = provider.get(name);
          if (value !== null) this.trackSecret(name, value);
        } catch {
        }
      }
    }
  }
}

export function getScopeSecretStore(scopeRoot: string): SecretStore {
  const key = canonicalizeTrustedRoot(scopeRoot);
  const existing = scopeSecretStores.get(key);
  if (existing) return existing;
  const store = new SecretStore(key);
  scopeSecretStores.set(key, store);
  return store;
}

export function maskKnownSecretValues(text: string): string {
  let masked = text;
  for (const store of scopeSecretStores.values()) {
    masked = store.mask(masked);
  }
  return masked;
}

export function resetSecretStores(): void {
  scopeSecretStores.clear();
  globalFileProviders.clear();
}
