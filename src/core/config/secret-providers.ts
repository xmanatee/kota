/**
 * Secret provider implementations — env file, JSON file, and macOS keychain.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import { SecretFileStorage } from "./secret-file-storage.js";

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

  private data: Record<string, string> | null = null;
  private storage: SecretFileStorage;

  constructor(filePath: string, name?: string) {
    this.storage = new SecretFileStorage(filePath);
    this.name = name ?? "file";
  }

  get(key: string): string | null {
    const data = this.load();
    return Object.hasOwn(data, key) ? data[key]! : null;
  }

  set(key: string, value: string): void {
    const data = { ...this.load(), [key]: value };
    this.save(data);
  }

  remove(key: string): boolean {
    const data = { ...this.load() };
    if (!Object.hasOwn(data, key)) return false;
    delete data[key];
    this.save(data);
    return true;
  }

  list(): string[] {
    return Object.keys(this.load());
  }

  private load(): Record<string, string> {
    if (this.data) return this.data;
    const raw = this.storage.read();
    if (raw === undefined) {
      this.data = {};
      return this.data;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      this.data = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] =>
          typeof entry[1] === "string"
        ))
        : {};
    } catch {
      this.data = {};
    }
    return this.data as Record<string, string>;
  }

  private save(data: Record<string, string>): void {
    this.storage.write(`${JSON.stringify(data, null, 2)}\n`);
    this.data = data;
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
      this.validateInput(key);
      const result = execFileSync(
        "security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", key, "-w"],
        { encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
      );
      return result.trim();
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    this.validateInput(key);
    this.validateInput(value);
    if (!this.isAvailable()) throw new Error("Keychain not available");
    this.remove(key);
    execFileSync(
      "security", ["add-generic-password", "-s", KEYCHAIN_SERVICE, "-a", key, "-w", value],
      { timeout: 5000 },
    );
  }

  remove(key: string): boolean {
    if (!this.isAvailable()) return false;
    try {
      this.validateInput(key);
      execFileSync(
        "security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", key],
        { timeout: 5000, stdio: "ignore" },
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
        execFileSync("security", ["help"], { timeout: 3000, stdio: "ignore" });
      } catch {
        this.available = false;
      }
    }
    return this.available;
  }

  private validateInput(s: string): void {
    if (/[\n\r\0]/.test(s)) {
      throw new Error("Secret key/value must not contain newlines or null bytes");
    }
  }
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
