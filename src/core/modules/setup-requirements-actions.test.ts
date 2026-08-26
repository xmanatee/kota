import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getProjectSecretStore } from "#core/config/secrets.js";
import {
  configRequirement,
  createModuleSetupTestHarness,
  oauthRequirement,
  oauthRequirementWithPolicyTtl,
} from "./setup-requirements-test-support.js";

describe("module setup actions", () => {
  const harness = createModuleSetupTestHarness();

  beforeEach(() => harness.setup());
  afterEach(() => harness.cleanup());

  it("returns an executable OAuth URL once while keeping status and durable state safe", async () => {
    const sut = harness.service([oauthRequirement()]);

    const started = await sut.start("demo", "oauth");
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.message);
    const executableUrl = new URL(started.action.url);
    expect(executableUrl.searchParams.get("state")).toBe("secret-state");
    expect(executableUrl.searchParams.get("next")).toBe("/setup");
    expect(started.status.state).toBe("pending");
    expect(JSON.stringify(started.status)).not.toContain("secret-state");
    const storedActions = JSON.parse(
      readFileSync(join(harness.projectDir, ".kota", "setup-actions.json"), "utf8"),
    ) as { actions: Array<Record<string, unknown>> };
    expect(
      statSync(join(harness.projectDir, ".kota", "setup-actions.json")).mode & 0o777,
    ).toBe(0o600);
    expect(storedActions.actions[0]).not.toHaveProperty("url");
    expect(JSON.stringify(storedActions)).not.toContain("secret-state");

    const listed = await sut.list();
    expect(JSON.stringify(listed)).not.toContain("secret-state");

    const completed = await sut.complete(started.action.actionId, {
      secretValues: { DEMO_REFRESH_TOKEN: "refresh-token-secret-123" },
    });
    expect(JSON.stringify(completed)).not.toContain("refresh-token-secret-123");
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      expect(completed.status.state).toBe("ready");
      expect(completed.status.secretRefs).toEqual([
        {
          name: "DEMO_REFRESH_TOKEN",
          scope: "project",
          present: true,
          source: "project-file",
        },
      ]);
    }
  });

  it("removes executable URLs from previous-format durable action records on read", async () => {
    const path = join(harness.projectDir, ".kota", "setup-actions.json");
    mkdirSync(join(harness.projectDir, ".kota"), { recursive: true });
    writeFileSync(path, JSON.stringify({
      actions: [{
        actionId: "demo.oauth.previous-format",
        moduleName: "demo",
        requirementId: "oauth",
        url: "https://example.com/callback/opaque-secret-token",
        label: "Open setup",
        status: "pending",
        createdAt: "2026-02-03T00:00:00.000Z",
        expiresAt: "2026-02-03T00:30:00.000Z",
      }],
    }));

    await harness.service([oauthRequirement()]).list();

    expect(readFileSync(path, "utf8")).not.toContain("opaque-secret-token");
    expect(JSON.parse(readFileSync(path, "utf8")).actions[0]).not.toHaveProperty("url");
  });

  it("rejects unknown fields and values outside declared setup options", async () => {
    const base = configRequirement();
    const requirement = {
      ...base,
      setup: {
        mode: "form" as const,
        fields: [{
          ...base.setup.fields[0]!,
          options: [
            { value: "https://api.example.test", label: "Production" },
            { value: "https://staging.example.test", label: "Staging" },
          ],
        }],
      },
    };
    const sut = harness.service([requirement]);

    await expect(sut.submitForm("demo", "endpoint", {
      "base-url": "https://undeclared.example.test",
    })).resolves.toMatchObject({ ok: false, reason: "invalid_request" });
    await expect(sut.submitForm("demo", "endpoint", {
      "base-url": "https://api.example.test",
      extra: "ignored-before",
    })).resolves.toMatchObject({ ok: false, reason: "invalid_request" });
    await expect(sut.submitForm("demo", "endpoint", {
      "base-url": "https://api.example.test",
    })).resolves.toMatchObject({ ok: true });
  });

  it("rejects expired setup action completion before writing submitted values", async () => {
    const sut = harness.service([oauthRequirement()]);
    const started = await sut.start("demo", "oauth");
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.message);

    harness.setNow(new Date("2026-01-01T00:00:02.000Z"));
    const rejected = await sut.complete(started.action.actionId, {
      configValues: { "base-url": "https://expired.example.test" },
      secretValues: { DEMO_REFRESH_TOKEN: "expired-refresh-token-secret" },
    });

    expect(rejected).toMatchObject({
      ok: false,
      reason: "invalid_request",
      message: expect.stringContaining("expired"),
    });
    expect(existsSync(join(harness.projectDir, ".kota", "config.json"))).toBe(false);
    expect(existsSync(join(harness.projectDir, ".kota", "secrets.json"))).toBe(false);
    expect(JSON.stringify(rejected)).not.toContain("expired-refresh-token-secret");
  });

  it("rejects revoked setup action completion before writing submitted secrets", async () => {
    const sut = harness.service([oauthRequirement()]);
    const started = await sut.start("demo", "oauth");
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.message);

    const revoked = await sut.revoke("demo", "oauth");
    expect(revoked.ok).toBe(true);
    const rejected = await sut.complete(started.action.actionId, {
      secretValues: { DEMO_REFRESH_TOKEN: "revoked-refresh-token-secret" },
    });

    expect(rejected).toMatchObject({
      ok: false,
      reason: "invalid_request",
      message: expect.stringContaining("revoked"),
    });
    expect(existsSync(join(harness.projectDir, ".kota", "secrets.json"))).toBe(false);
    expect(JSON.stringify(rejected)).not.toContain("revoked-refresh-token-secret");
  });

  it("rejects completed setup action completion before overwriting stored secrets", async () => {
    const sut = harness.service([oauthRequirement()]);
    const started = await sut.start("demo", "oauth");
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.message);

    const completed = await sut.complete(started.action.actionId, {
      secretValues: { DEMO_REFRESH_TOKEN: "original-refresh-token-secret" },
    });
    expect(completed.ok).toBe(true);

    const rejected = await sut.complete(started.action.actionId, {
      secretValues: { DEMO_REFRESH_TOKEN: "replacement-refresh-token-secret" },
    });

    expect(rejected).toMatchObject({
      ok: false,
      reason: "invalid_request",
      message: expect.stringContaining("completed"),
    });
    expect(getProjectSecretStore(harness.projectDir).get("DEMO_REFRESH_TOKEN")).toBe(
      "original-refresh-token-secret",
    );
    expect(JSON.stringify(rejected)).not.toContain("replacement-refresh-token-secret");
  });

  it("rejects malformed setup actions before applying form values", async () => {
    const sut = harness.service([configRequirement()]);
    mkdirSync(join(harness.projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(harness.projectDir, ".kota", "setup-actions.json"),
      `${JSON.stringify({
        actions: [{
          actionId: "demo.endpoint.malformed",
          moduleName: "demo",
          requirementId: "endpoint",
          url: "https://auth.example.test/start",
          label: "Open setup",
          status: "pending",
          createdAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-01-01T00:10:00.000Z",
        }],
      }, null, 2)}\n`,
      "utf8",
    );

    const rejected = await sut.complete("demo.endpoint.malformed", {
      configValues: { "base-url": "https://malformed.example.test" },
    });

    expect(rejected).toMatchObject({
      ok: false,
      reason: "invalid_request",
      message: expect.stringContaining("URL setup"),
    });
    expect(existsSync(join(harness.projectDir, ".kota", "config.json"))).toBe(false);
  });

  it("rejects setup actions with malformed status before writing submitted secrets", async () => {
    const sut = harness.service([oauthRequirement()]);
    mkdirSync(join(harness.projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(harness.projectDir, ".kota", "setup-actions.json"),
      `${JSON.stringify({
        actions: [{
          actionId: "demo.oauth.malformed",
          moduleName: "demo",
          requirementId: "oauth",
          url: "https://auth.example.test/start",
          label: "Open OAuth",
          status: "paused",
          createdAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-01-01T00:10:00.000Z",
        }],
      }, null, 2)}\n`,
      "utf8",
    );

    const rejected = await sut.complete("demo.oauth.malformed", {
      secretValues: { DEMO_REFRESH_TOKEN: "malformed-refresh-token-secret" },
    });

    expect(rejected).toMatchObject({
      ok: false,
      reason: "invalid_request",
      message: expect.stringContaining("invalid status"),
    });
    expect(existsSync(join(harness.projectDir, ".kota", "secrets.json"))).toBe(false);
    expect(JSON.stringify(rejected)).not.toContain("malformed-refresh-token-secret");
  });

  it("reports expired URL setup for reauth-capable OAuth requirements", async () => {
    const sut = harness.service([oauthRequirement()]);
    const started = await sut.start("demo", "oauth");
    expect(started.ok).toBe(true);

    harness.setNow(new Date("2026-01-01T00:00:02.000Z"));
    const listed = await sut.list();
    expect(listed.requirements[0]).toMatchObject({
      kind: "oauth",
      sensitivity: "oauth",
      state: "expired",
      reason: "url_setup_expired",
    });
  });

  it("uses evidence-policy pending retention as the default URL setup expiry", async () => {
    const sut = harness.service([oauthRequirementWithPolicyTtl()]);
    const started = await sut.start("demo", "oauth");
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.message);
    expect(started.action.expiresAt).toBe("2026-01-01T00:10:00.000Z");

    harness.setNow(new Date("2026-01-01T00:09:59.000Z"));
    expect((await sut.list()).requirements[0]?.state).toBe("pending");

    harness.setNow(new Date("2026-01-01T00:10:00.000Z"));
    expect((await sut.list()).requirements[0]?.state).toBe("expired");
  });
});
