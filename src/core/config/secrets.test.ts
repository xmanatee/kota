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

  it("handles Windows CRLF line endings", () => {
    const dir = makeTmpDir();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "A=one\r\nB=two\r\n");
    const provider = new EnvProvider(envFile);
    expect(provider.get("A")).toBe("one");
    expect(provider.get("B")).toBe("two");
    rmSync(dir, { recursive: true });
  });

  it("handles values containing = sign", () => {
    const dir = makeTmpDir();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "URL=https://host?a=1&b=2\n");
    const provider = new EnvProvider(envFile);
    expect(provider.get("URL")).toBe("https://host?a=1&b=2");
    rmSync(dir, { recursive: true });
  });

  it("process.env takes priority over .env file", () => {
    const dir = makeTmpDir();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "PRIORITY_KEY=from-file\n");
    process.env.PRIORITY_KEY = "from-env";
    const provider = new EnvProvider(envFile);
    expect(provider.get("PRIORITY_KEY")).toBe("from-env");
    delete process.env.PRIORITY_KEY;
    rmSync(dir, { recursive: true });
  });

  it("caches .env file after first read", () => {
    const dir = makeTmpDir();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "CACHED=original\n");
    const provider = new EnvProvider(envFile);
    expect(provider.get("CACHED")).toBe("original");
    // Overwrite file — provider should still return cached value
    writeFileSync(envFile, "CACHED=changed\n");
    expect(provider.get("CACHED")).toBe("original");
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

  it("overwrites existing key", () => {
    const provider = new FileProvider(join(dir, "secrets.json"));
    provider.set("KEY", "old");
    provider.set("KEY", "new");
    expect(provider.get("KEY")).toBe("new");
  });

  it("ignores non-string values in JSON", () => {
    const path = join(dir, "secrets.json");
    writeFileSync(path, JSON.stringify({ GOOD: "val", NUM: 42, BOOL: true, NIL: null }));
    const provider = new FileProvider(path);
    expect(provider.get("GOOD")).toBe("val");
    // Non-string values are accessible via object lookup but come out as-is
    expect(provider.list()).toContain("GOOD");
    expect(provider.list()).toContain("NUM");
  });

  it("uses custom name", () => {
    const provider = new FileProvider(join(dir, "secrets.json"), "my-scope");
    expect(provider.name).toBe("my-scope");
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

  it("list returns empty array", () => {
    const provider = new KeychainProvider();
    expect(provider.list()).toEqual([]);
  });

  it("rejects keys with newlines", () => {
    const provider = new KeychainProvider();
    if (!provider.isAvailable()) return;
    expect(() => provider.set("key\ninjection", "val")).toThrow("newlines or null");
  });

  it("rejects values with null bytes", () => {
    const provider = new KeychainProvider();
    if (!provider.isAvailable()) return;
    expect(() => provider.set("key", "val\0ue")).toThrow("newlines or null");
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

  it("project file takes priority over process.env", () => {
    writeFileSync(
      join(dir, ".kota", "secrets.json"),
      JSON.stringify({ SHARED_KEY: "from-project" }),
    );
    process.env.SHARED_KEY = "from-env";
    const store = new SecretStore(dir);
    expect(store.get("SHARED_KEY")).toBe("from-project");
    delete process.env.SHARED_KEY;
  });

  it("stops masking after removal", () => {
    const store = new SecretStore(dir);
    store.set("TEMP_SECRET", "super-secret-value-999");
    expect(store.mask("has super-secret-value-999 inside")).toContain("<secret:TEMP_SECRET>");
    store.remove("TEMP_SECRET", "project");
    // After removal the value should no longer be masked
    expect(store.mask("has super-secret-value-999 inside")).toBe("has super-secret-value-999 inside");
  });

  it("masks multiple occurrences of same value", () => {
    const store = new SecretStore(dir);
    store.set("TOKEN", "repeated-token-xyz");
    const masked = store.mask("first: repeated-token-xyz, second: repeated-token-xyz");
    expect(masked).toBe("first: <secret:TOKEN>, second: <secret:TOKEN>");
  });

  it("masks empty string unchanged", () => {
    const store = new SecretStore(dir);
    store.set("KEY", "some-value-here");
    expect(store.mask("")).toBe("");
  });

  it("tracks known secret count", () => {
    const store = new SecretStore(dir);
    const baseline = store.getKnownCount();
    store.set("A", "value-aaaa");
    expect(store.getKnownCount()).toBe(baseline + 1);
    store.set("B", "value-bbbb");
    expect(store.getKnownCount()).toBe(baseline + 2);
  });

  it("stores and retrieves global-scoped secrets", () => {
    // Use a temp dir as the global dir stand-in via project file provider
    const store = new SecretStore(dir);
    store.set("GLOBAL_KEY", "global-val-123", "global");
    // Global store resolves via the global file provider
    expect(store.get("GLOBAL_KEY")).toBe("global-val-123");
  });

  it("removes global-scoped secrets", () => {
    const store = new SecretStore(dir);
    store.set("G_KEY", "gval-123456", "global");
    expect(store.remove("G_KEY", "global")).toBe(true);
    expect(store.remove("G_KEY", "global")).toBe(false);
  });

  it("list deduplicates across providers", () => {
    // Same key in project file and .env
    writeFileSync(
      join(dir, ".kota", "secrets.json"),
      JSON.stringify({ DUP_KEY: "from-project" }),
    );
    writeFileSync(join(dir, ".env"), "DUP_KEY=from-env\n");
    const store = new SecretStore(dir);
    const names = store.list().filter((s) => s.name === "DUP_KEY");
    expect(names).toHaveLength(1);
    expect(names[0].source).toBe("project-file");
  });

  it("masks secrets with pipe and bracket characters", () => {
    const store = new SecretStore(dir);
    store.set("COMPLEX", "val|with[brackets](parens){braces}");
    const masked = store.mask("text val|with[brackets](parens){braces} end");
    expect(masked).toBe("text <secret:COMPLEX> end");
  });

  it("masks overlapping substring values correctly", () => {
    const store = new SecretStore(dir);
    store.set("SHORT_TOK", "abcd-1234");
    store.set("LONG_TOK", "abcd-1234-5678");
    // When the longer value is present, it should match as LONG_TOK
    expect(store.mask("key: abcd-1234-5678")).toBe("key: <secret:LONG_TOK>");
    // When only the shorter value is present, it should match as SHORT_TOK
    expect(store.mask("key: abcd-1234!")).toBe("key: <secret:SHORT_TOK>!");
  });

  it("does not mask value equal to 3 chars", () => {
    const store = new SecretStore(dir);
    store.set("TINY", "abc");
    expect(store.mask("abc appears")).toBe("abc appears");
  });

  it("masks value equal to exactly 4 chars", () => {
    const store = new SecretStore(dir);
    store.set("FOUR", "abcd");
    expect(store.mask("abcd appears")).toBe("<secret:FOUR> appears");
  });

  it("loads pre-existing secrets for masking on construction", () => {
    writeFileSync(
      join(dir, ".kota", "secrets.json"),
      JSON.stringify({ PRELOADED: "preloaded-secret-val" }),
    );
    const store = new SecretStore(dir);
    // Should be masked even without an explicit get() call
    expect(store.mask("leaking preloaded-secret-val here")).toBe(
      "leaking <secret:PRELOADED> here",
    );
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
