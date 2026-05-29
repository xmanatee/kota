/**
 * Secrets management — provider-based secret storage with output masking.
 *
 * Secrets are resolved through a provider chain (project file → global file → env → keychain).
 * All known secret values are masked in tool output before reaching the LLM context.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
  EnvProvider,
  escapeRegex,
  FileProvider,
  KeychainProvider,
} from "./secret-providers.js";

export type { SecretProvider } from "./secret-providers.js";
export { EnvProvider, FileProvider, KeychainProvider } from "./secret-providers.js";

export type SecretScope = "project" | "global";

const GLOBAL_DIR = join(homedir(), ".kota");
const PROJECT_DIR = ".kota";
const SECRETS_FILE = "secrets.json";

export type SecretStoreOptions = {
  globalDir: string;
};

export class SecretStore {
  private providers: (EnvProvider | FileProvider | KeychainProvider)[];
  private projectFileProvider: FileProvider;
  private globalFileProvider: FileProvider;
  /** Cached known values for masking — maps value → name. */
  private knownSecrets = new Map<string, string>();
  private maskRegex: RegExp | null = null;

  constructor(cwd?: string, options?: SecretStoreOptions) {
    const projectDir = cwd || process.cwd();
    const globalDir = options?.globalDir ?? GLOBAL_DIR;

    this.projectFileProvider = new FileProvider(
      join(projectDir, PROJECT_DIR, SECRETS_FILE),
      "project-file",
    );
    this.globalFileProvider = new FileProvider(
      join(globalDir, SECRETS_FILE),
      "global-file",
    );

    const projectEnv = new EnvProvider(join(projectDir, ".env"));
    const globalEnv = new EnvProvider(join(globalDir, ".env"));
    const keychain = new KeychainProvider();

    // Provider chain: project file → global file → project .env → global .env → keychain
    this.providers = [
      this.projectFileProvider,
      this.globalFileProvider,
      projectEnv,
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
  set(key: string, value: string, scope: SecretScope = "project"): void {
    const provider = scope === "global" ? this.globalFileProvider : this.projectFileProvider;
    provider.set(key, value);
    this.trackSecret(key, value);
  }

  /** Remove a secret from the specified scope. */
  remove(key: string, scope: SecretScope = "project"): boolean {
    const provider = scope === "global" ? this.globalFileProvider : this.projectFileProvider;
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

  /** Inject a secret into process.env for shell/code_exec tool use. */
  inject(key: string): boolean {
    const value = this.get(key);
    if (value === null) return false;
    process.env[key] = value;
    return true;
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

// --- Singleton ---

let store: SecretStore | null = null;

export function initSecretStore(cwd?: string): SecretStore {
  store = new SecretStore(cwd);
  return store;
}

export function getSecretStore(): SecretStore | null {
  return store;
}

export function resetSecretStore(): void {
  store = null;
}
