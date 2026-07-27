import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getSecretStore,
  initSecretStore,
  resetSecretStore,
  SecretStore,
} from "./secrets.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-secrets-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("SecretStore", () => {
  let dir: string;
  let globalDir: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    dir = makeTmpDir();
    globalDir = join(dir, "global");
    mkdirSync(join(dir, ".kota"), { recursive: true });
    mkdirSync(globalDir, { recursive: true });
    originalEnv = { ...process.env };
    resetSecretStore();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (originalEnv[key] === undefined) delete process.env[key];
    }
    rmSync(dir, { recursive: true });
    resetSecretStore();
  });

  it("resolves secrets through provider chain", () => {
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

    const data = JSON.parse(readFileSync(join(dir, ".kota", "secrets.json"), "utf-8"));
    expect(data.MY_KEY).toBe("my-value");
  });

  it("removes secrets", () => {
    const key = "KOTA_TEST_REMOVABLE_SECRET";
    const previous = process.env[key];
    delete process.env[key];
    const store = new SecretStore(dir);
    try {
      store.set(key, "val");
      expect(store.remove(key, "project")).toBe(true);
      expect(store.get(key)).toBeNull();
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
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
    const masked = store.mask("token: secret-key-12345");
    expect(masked).toBe("token: <secret:FULL>");
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
    const store = new SecretStore(dir, { globalDir });
    store.set("GLOBAL_KEY", "global-val-123", "global");
    expect(store.get("GLOBAL_KEY")).toBe("global-val-123");
  });

  it("removes global-scoped secrets", () => {
    const store = new SecretStore(dir, { globalDir });
    store.set("G_KEY", "gval-123456", "global");
    expect(store.remove("G_KEY", "global")).toBe(true);
    expect(store.remove("G_KEY", "global")).toBe(false);
  });

  it("list deduplicates across providers", () => {
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
    expect(store.mask("key: abcd-1234-5678")).toBe("key: <secret:LONG_TOK>");
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
