import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EnvProvider,
  FileProvider,
  getSecretStore,
  initSecretStore,
  KeychainProvider,
  resetSecretStore,
  SecretStore,
} from "./secrets.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-secrets-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("EnvProvider", () => {
  it("reads from process.env", () => {
    process.env.KOTA_TEST_SECRET = "test-value-123";
    const provider = new EnvProvider();
    expect(provider.get("KOTA_TEST_SECRET")).toBe("test-value-123");
    delete process.env.KOTA_TEST_SECRET;
  });

  it("returns null for missing keys", () => {
    const provider = new EnvProvider();
    expect(provider.get("KOTA_NONEXISTENT_KEY_XYZ")).toBeNull();
  });

  it("reads .env file", () => {
    const dir = makeTmpDir();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, 'FOO=bar\nBAZ="quoted value"\n# comment\nEMPTY=\n');
    const provider = new EnvProvider(envFile);

    expect(provider.get("FOO")).toBe("bar");
    expect(provider.get("BAZ")).toBe("quoted value");
    expect(provider.get("EMPTY")).toBe("");
    expect(provider.list()).toEqual(["FOO", "BAZ", "EMPTY"]);

    rmSync(dir, { recursive: true });
  });

  it("handles missing .env file", () => {
    const provider = new EnvProvider("/nonexistent/.env");
    expect(provider.get("FOO")).toBeNull();
    expect(provider.list()).toEqual([]);
  });

  it("is read-only", () => {
    const provider = new EnvProvider();
    expect(provider.writable).toBe(false);
    expect(() => provider.set("x", "y")).toThrow("read-only");
    expect(() => provider.remove("x")).toThrow("read-only");
  });

  it("parses single-quoted values", () => {
    const dir = makeTmpDir();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "KEY='single quoted'\n");
    const provider = new EnvProvider(envFile);
    expect(provider.get("KEY")).toBe("single quoted");
    rmSync(dir, { recursive: true });
  });

  it("skips malformed lines", () => {
    const dir = makeTmpDir();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "GOOD=value\nBADLINE\n=nokey\n\n");
    const provider = new EnvProvider(envFile);
    expect(provider.list()).toEqual(["GOOD"]);
    rmSync(dir, { recursive: true });
  });
});

describe("FileProvider", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it("stores and retrieves secrets", () => {
    const provider = new FileProvider(join(dir, "secrets.json"));
    provider.set("API_KEY", "sk-123");
    expect(provider.get("API_KEY")).toBe("sk-123");
  });

  it("persists to disk", () => {
    const path = join(dir, "secrets.json");
    const p1 = new FileProvider(path);
    p1.set("TOKEN", "abc");

    // New instance reads from disk
    const p2 = new FileProvider(path);
    expect(p2.get("TOKEN")).toBe("abc");
  });

  it("lists secret names", () => {
    const provider = new FileProvider(join(dir, "secrets.json"));
    provider.set("A", "1");
    provider.set("B", "2");
    expect(provider.list().sort()).toEqual(["A", "B"]);
  });

  it("removes secrets", () => {
    const provider = new FileProvider(join(dir, "secrets.json"));
    provider.set("KEY", "val");
    expect(provider.remove("KEY")).toBe(true);
    expect(provider.get("KEY")).toBeNull();
    expect(provider.remove("KEY")).toBe(false);
  });

  it("creates parent directories", () => {
    const nested = join(dir, "deep", "nested", "secrets.json");
    const provider = new FileProvider(nested);
    provider.set("KEY", "val");
    expect(existsSync(nested)).toBe(true);
  });

  it("handles corrupted JSON", () => {
    const path = join(dir, "secrets.json");
    writeFileSync(path, "not json{{{");
    const provider = new FileProvider(path);
    expect(provider.list()).toEqual([]);
    expect(provider.get("KEY")).toBeNull();
  });

  it("handles non-object JSON", () => {
    const path = join(dir, "secrets.json");
    writeFileSync(path, "[1,2,3]");
    const provider = new FileProvider(path);
    expect(provider.list()).toEqual([]);
  });

  it("is writable", () => {
    const provider = new FileProvider(join(dir, "secrets.json"));
    expect(provider.writable).toBe(true);
  });
});

describe("KeychainProvider", () => {
  it("reports availability based on platform", () => {
    const provider = new KeychainProvider();
    // Just ensure it doesn't crash
    const available = provider.isAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("returns null for missing keys", () => {
    const provider = new KeychainProvider();
    // Even if keychain is available, this non-existent key should return null
    expect(provider.get("KOTA_NONEXISTENT_TEST_KEY_12345")).toBeNull();
  });
});

describe("SecretStore", () => {
  let dir: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    dir = makeTmpDir();
    mkdirSync(join(dir, ".kota"), { recursive: true });
    originalEnv = { ...process.env };
    resetSecretStore();
  });

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (originalEnv[key] === undefined) delete process.env[key];
    }
    rmSync(dir, { recursive: true });
    resetSecretStore();
  });

  it("resolves secrets through provider chain", () => {
    // Set up a project-level secret
    writeFileSync(
      join(dir, ".kota", "secrets.json"),
      JSON.stringify({ PROJECT_TOKEN: "proj-123" }),
    );
    const store = new SecretStore(dir);
    expect(store.get("PROJECT_TOKEN")).toBe("proj-123");
  });

  it("resolves from process.env", () => {
    process.env.KOTA_ENV_SECRET = "env-val-456";
    const store = new SecretStore(dir);
    expect(store.get("KOTA_ENV_SECRET")).toBe("env-val-456");
    delete process.env.KOTA_ENV_SECRET;
  });

  it("stores and retrieves project-scoped secrets", () => {
    const store = new SecretStore(dir);
    store.set("MY_KEY", "my-value", "project");
    expect(store.get("MY_KEY")).toBe("my-value");

    // Verify it was written to project scope
    const data = JSON.parse(readFileSync(join(dir, ".kota", "secrets.json"), "utf-8"));
    expect(data.MY_KEY).toBe("my-value");
  });

  it("removes secrets", () => {
    const store = new SecretStore(dir);
    store.set("TEMP", "val");
    expect(store.remove("TEMP", "project")).toBe(true);
    expect(store.get("TEMP")).toBeNull();
  });

  it("lists all secrets across providers", () => {
    writeFileSync(
      join(dir, ".kota", "secrets.json"),
      JSON.stringify({ A: "1", B: "2" }),
    );
    const store = new SecretStore(dir);
    const list = store.list();
    const names = list.map((s) => s.name);
    expect(names).toContain("A");
    expect(names).toContain("B");
  });

  it("masks secret values in text", () => {
    const store = new SecretStore(dir);
    store.set("API_KEY", "sk-ant-api-1234567890");
    const masked = store.mask("The key is sk-ant-api-1234567890, use it wisely.");
    expect(masked).toBe("The key is <secret:API_KEY>, use it wisely.");
    expect(masked).not.toContain("sk-ant-api-1234567890");
  });

  it("masks multiple secrets", () => {
    const store = new SecretStore(dir);
    store.set("KEY_A", "secret-aaa-111");
    store.set("KEY_B", "secret-bbb-222");
    const text = "A=secret-aaa-111, B=secret-bbb-222";
    const masked = store.mask(text);
    expect(masked).toBe("A=<secret:KEY_A>, B=<secret:KEY_B>");
  });

  it("does not mask short values (< 4 chars)", () => {
    const store = new SecretStore(dir);
    store.set("SHORT", "ab");
    expect(store.mask("ab is short")).toBe("ab is short");
  });

  it("returns text unchanged when no secrets", () => {
    const store = new SecretStore(dir);
    expect(store.mask("no secrets here")).toBe("no secrets here");
  });

  it("masks longer values first", () => {
    const store = new SecretStore(dir);
    store.set("FULL", "secret-key-12345");
    store.set("PARTIAL", "secret-key");
    // The longer match should win
    const masked = store.mask("token: secret-key-12345");
    expect(masked).toBe("token: <secret:FULL>");
  });

  it("injects secrets into process.env", () => {
    const store = new SecretStore(dir);
    store.set("INJECT_TEST", "injected-value-xyz");
    expect(store.inject("INJECT_TEST")).toBe(true);
    expect(process.env.INJECT_TEST).toBe("injected-value-xyz");
    delete process.env.INJECT_TEST;
  });

  it("inject returns false for missing secrets", () => {
    const store = new SecretStore(dir);
    expect(store.inject("NONEXISTENT")).toBe(false);
  });

  it("handles regex special characters in secret values", () => {
    const store = new SecretStore(dir);
    store.set("REGEX_KEY", "value+with.special*chars");
    const masked = store.mask("the secret is value+with.special*chars okay");
    expect(masked).toBe("the secret is <secret:REGEX_KEY> okay");
  });
});

describe("singleton", () => {
  it("initSecretStore / getSecretStore / resetSecretStore", () => {
    resetSecretStore();
    expect(getSecretStore()).toBeNull();

    const dir = makeTmpDir();
    const store = initSecretStore(dir);
    expect(store).toBeInstanceOf(SecretStore);
    expect(getSecretStore()).toBe(store);

    resetSecretStore();
    expect(getSecretStore()).toBeNull();
    rmSync(dir, { recursive: true });
  });
});
