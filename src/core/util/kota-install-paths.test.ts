import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readKotaPrompt, resolveKotaRuntimeAsset } from "./kota-install-paths.js";

describe("authorized prompt reads", () => {
  let root: string;
  let scope: string;
  let external: string;
  const bundled = "src/core/modules/AGENTS.md";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-prompt-read-"));
    scope = join(root, "scope");
    external = join(root, "external");
    mkdirSync(scope);
    mkdirSync(external);
    writeFileSync(join(external, "prompt.md"), "EXTERNAL SENTINEL");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("preserves packaged fallback, local precedence, absolute contained paths and empty overrides", () => {
    expect(readKotaPrompt(scope, bundled)).toBe(readFileSync(resolveKotaRuntimeAsset(bundled), "utf8"));
    const override = join(scope, bundled);
    mkdirSync(dirname(override), { recursive: true });
    writeFileSync(override, "local guidance");
    expect(readKotaPrompt(scope, bundled)).toBe("local guidance");
    expect(readKotaPrompt(scope, override)).toBe("local guidance");
    writeFileSync(override, "");
    expect(readKotaPrompt(scope, bundled)).toBe("");
  });

  it.each(["leaf", "ancestor", "dangling", "hard"])("rejects %s links instead of disclosing or falling back", kind => {
    const override = join(scope, bundled);
    mkdirSync(dirname(override), { recursive: true });
    if (kind === "ancestor") {
      rmSync(dirname(override), { recursive: true });
      writeFileSync(join(external, "AGENTS.md"), "EXTERNAL SENTINEL");
      symlinkSync(external, dirname(override));
    } else if (kind === "hard") {
      linkSync(join(external, "prompt.md"), override);
    } else {
      symlinkSync(join(external, kind === "dangling" ? "missing" : "prompt.md"), override);
    }
    expect(() => readKotaPrompt(scope, bundled)).toThrow(/Unsafe filesystem path/);
  });

  it.each([".env", "nested/.env.local", ".kota/secrets.json", ".kota/daemon-control.json", ".kota/openai-tools-agent-harness/sessions/private.json"])("rejects protected project prompt %s before reading", path => {
    expect(() => readKotaPrompt(scope, path)).toThrow(/access denied for protected/);
  });

  it("requires independent external authority and keeps that authority beneath its root", () => {
    const file = join(external, "prompt.md");
    expect(() => readKotaPrompt(scope, file)).toThrow(/outside authorized roots/);
    expect(() => readKotaPrompt(scope, "../external/prompt.md")).toThrow(/outside authorized roots/);
    const policy = { trustedExternalRoots: [external] };
    expect(readKotaPrompt(scope, file, policy)).toBe("EXTERNAL SENTINEL");
    expect(() => readKotaPrompt(scope, join(external, ".env"), policy)).toThrow(/access denied for protected/);
    const sibling = join(root, "external-sibling");
    mkdirSync(sibling);
    writeFileSync(join(sibling, "prompt.md"), "UNAUTHORIZED");
    expect(() => readKotaPrompt(scope, join(sibling, "prompt.md"), policy)).toThrow(/outside authorized roots/);
    symlinkSync(join(sibling, "prompt.md"), join(external, "escape.md"));
    expect(() => readKotaPrompt(scope, join(external, "escape.md"), policy)).toThrow(/Unsafe filesystem path/);
  });

  it("protects a custom machine authority token even inside an authorized external root", () => {
    const policy = { trustedExternalRoots: [external], authorityConfigPath: join(external, "config.json") };
    expect(() => readKotaPrompt(scope, join(external, "scope-authority-token.json"), policy)).toThrow(/access denied for protected/);
  });
});
