/**
 * Secret provider implementations — env file, JSON file, and macOS keychain.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { dirname } from "node:path";

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
    const envVal = process.env[key];
    if (envVal !== undefined) return envVal;
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
    if (/[\n\r\0]/.test(s)) {
      throw new Error("Secret key/value must not contain newlines or null bytes");
    }
    return s.replace(/["\\$`]/g, "\\$&");
  }
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
