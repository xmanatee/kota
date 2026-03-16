/**
 * Secrets management — provider-based secret storage with output masking.
 *
 * Secrets are resolved through a provider chain (project file → global file → env → keychain).
 * All known secret values are masked in tool output before reaching the LLM context.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export interface SecretProvider {
  readonly name: string;
  readonly writable: boolean;
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): boolean;
  list(): string[];
}

// --- Env Provider ---

export class EnvProvider implements SecretProvider {
  readonly name = "env";
  readonly writable = false;

  private envFileCache: Record<string, string> | null = null;
  private envFilePath: string | null;

  constructor(envFilePath?: string) {
    this.envFilePath = envFilePath ?? null;
  }

  get(key: string): string | null {
    // Check process.env first
    const envVal = process.env[key];
    if (envVal !== undefined) return envVal;

    // Then check .env file
    return this.loadEnvFile()[key] ?? null;
  }

  set(_key: string, _value: string): void {
    throw new Error("EnvProvider is read-only");
  }

  remove(_key: string): boolean {
    throw new Error("EnvProvider is read-only");
  }

  list(): string[] {
    return Object.keys(this.loadEnvFile());
  }

  private loadEnvFile(): Record<string, string> {
    if (this.envFileCache) return this.envFileCache;
    this.envFileCache = {};
    if (!this.envFilePath || !existsSync(this.envFilePath)) return this.envFileCache;

    const content = readFileSync(this.envFilePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      this.envFileCache[key] = value;
    }
    return this.envFileCache;
  }
}

// --- File Provider ---

export class FileProvider implements SecretProvider {
  readonly name: string;
  readonly writable = true;

  private filePath: string;
  private data: Record<string, string> | null = null;

  constructor(filePath: string, name?: string) {
    this.filePath = filePath;
    this.name = name ?? "file";
  }

  get(key: string): string | null {
    return this.load()[key] ?? null;
  }

  set(key: string, value: string): void {
    const data = this.load();
    data[key] = value;
    this.save(data);
  }

  remove(key: string): boolean {
    const data = this.load();
    if (!(key in data)) return false;
    delete data[key];
    this.save(data);
    return true;
  }

  list(): string[] {
    return Object.keys(this.load());
  }

  private load(): Record<string, string> {
    if (this.data) return this.data;
    if (!existsSync(this.filePath)) {
      this.data = {};
      return this.data;
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      this.data = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      this.data = {};
    }
    return this.data as Record<string, string>;
  }

  private save(data: Record<string, string>): void {
    this.data = data;
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  }
}

// --- Keychain Provider (macOS) ---

const KEYCHAIN_SERVICE = "kota-secrets";

export class KeychainProvider implements SecretProvider {
  readonly name = "keychain";
  readonly writable = true;

  private available: boolean | null = null;

  get(key: string): string | null {
    if (!this.isAvailable()) return null;
    try {
      const result = execSync(
        `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${this.escapeArg(key)}" -w 2>/dev/null`,
        { encoding: "utf-8", timeout: 5000 },
      );
      return result.trim();
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    if (!this.isAvailable()) throw new Error("Keychain not available");
    // Delete existing entry first (ignore errors if it doesn't exist)
    try {
      execSync(
        `security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${this.escapeArg(key)}" 2>/dev/null`,
        { timeout: 5000 },
      );
    } catch { /* ok */ }
    execSync(
      `security add-generic-password -s "${KEYCHAIN_SERVICE}" -a "${this.escapeArg(key)}" -w "${this.escapeArg(value)}"`,
      { timeout: 5000 },
    );
  }

  remove(key: string): boolean {
    if (!this.isAvailable()) return false;
    try {
      execSync(
        `security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${this.escapeArg(key)}" 2>/dev/null`,
        { timeout: 5000 },
      );
      return true;
    } catch {
      return false;
    }
  }

  list(): string[] {
    // macOS keychain doesn't support listing by service easily — return empty
    return [];
  }

  isAvailable(): boolean {
    if (this.available !== null) return this.available;
    this.available = platform() === "darwin";
    if (this.available) {
      try {
        execSync("security help 2>/dev/null", { timeout: 3000 });
      } catch {
        this.available = false;
      }
    }
    return this.available;
  }

  private escapeArg(s: string): string {
    return s.replace(/["\\$`]/g, "\\$&");
  }
}

// --- SecretStore ---

export type SecretScope = "project" | "global";

const GLOBAL_DIR = join(homedir(), ".kota");
const PROJECT_DIR = ".kota";
const SECRETS_FILE = "secrets.json";

export class SecretStore {
  private providers: SecretProvider[];
  private projectFileProvider: FileProvider;
  private globalFileProvider: FileProvider;
  /** Cached known values for masking — maps value → name. */
  private knownSecrets = new Map<string, string>();
  private maskRegex: RegExp | null = null;

  constructor(cwd?: string) {
    const projectDir = cwd || process.cwd();

    this.projectFileProvider = new FileProvider(
      join(projectDir, PROJECT_DIR, SECRETS_FILE),
      "project-file",
    );
    this.globalFileProvider = new FileProvider(
      join(GLOBAL_DIR, SECRETS_FILE),
      "global-file",
    );

    const projectEnv = new EnvProvider(join(projectDir, ".env"));
    const globalEnv = new EnvProvider(join(GLOBAL_DIR, ".env"));
    const keychain = new KeychainProvider();

    // Provider chain: project file → global file → project .env → global .env → keychain
    this.providers = [
      this.projectFileProvider,
      this.globalFileProvider,
      projectEnv,
      globalEnv,
    ];
    if (keychain.isAvailable()) {
      this.providers.push(keychain);
    }

    this.refreshKnownSecrets();
  }

  /** Resolve a secret by walking the provider chain. */
  get(key: string): string | null {
    for (const provider of this.providers) {
      const value = provider.get(key);
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
      this.knownSecrets.delete(key);
      this.maskRegex = null;
    }
    return removed;
  }

  /** List all known secret names across all providers. */
  list(): { name: string; source: string }[] {
    const seen = new Set<string>();
    const results: { name: string; source: string }[] = [];
    for (const provider of this.providers) {
      for (const name of provider.list()) {
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
    if (value.length < 4) return; // Don't mask very short values — too many false positives
    if (this.knownSecrets.get(value) === name) return;
    this.knownSecrets.set(value, name);
    this.maskRegex = null; // Invalidate cached regex
  }

  private getMaskRegex(): RegExp | null {
    if (this.maskRegex) return this.maskRegex;
    if (this.knownSecrets.size === 0) return null;

    // Sort by length descending so longer values match first
    const values = [...this.knownSecrets.keys()]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegex);

    this.maskRegex = new RegExp(values.join("|"), "g");
    return this.maskRegex;
  }

  /** Load all known secrets from writable providers for masking. */
  private refreshKnownSecrets(): void {
    for (const provider of this.providers) {
      for (const name of provider.list()) {
        const value = provider.get(name);
        if (value !== null) this.trackSecret(name, value);
      }
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
