import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  capabilityRequirement,
  createModuleSetupTestHarness,
  oauthRequirement,
} from "./setup-requirements-test-support.js";

describe("module setup status", () => {
  const harness = createModuleSetupTestHarness();

  beforeEach(() => harness.setup());
  afterEach(() => harness.cleanup());

  it("reports stored OAuth credentials as expired when readiness detects refresh failure", async () => {
    const sut = harness.service([oauthRequirement({ withHealth: true })]);
    harness.setCapabilities([{
      id: "demo.oauth",
      status: "unavailable",
      reason: "oauth_refresh_failed",
      message: "OAuth token refresh failed; reauthorization is required.",
    }]);

    const stored = await sut.storeSecret("demo", "oauth", {
      DEMO_REFRESH_TOKEN: "refresh-token-secret-789",
    });

    expect(stored).toMatchObject({
      ok: true,
      status: {
        state: "expired",
        reason: "oauth_refresh_failed",
      },
    });
    const listed = await sut.list();
    expect(listed.requirements[0]).toMatchObject({
      kind: "oauth",
      state: "expired",
      secretRefs: [{ name: "DEMO_REFRESH_TOKEN", present: true }],
      capabilities: [{
        id: "demo.oauth",
        status: "unavailable",
        reason: "oauth_refresh_failed",
      }],
    });
    expect(JSON.stringify(listed)).not.toContain("refresh-token-secret-789");
  });

  it("revokes stored credentials and records a revoked state", async () => {
    const sut = harness.service([oauthRequirement()]);
    const stored = await sut.storeSecret("demo", "oauth", {
      DEMO_REFRESH_TOKEN: "refresh-token-secret-456",
    });
    expect(stored.ok).toBe(true);

    const revoked = await sut.revoke("demo", "oauth");
    expect(revoked.ok).toBe(true);
    if (revoked.ok) {
      expect(revoked.status.state).toBe("revoked");
      expect(revoked.status.pendingAction?.status).toBe("revoked");
    }

    const listed = await sut.list();
    expect(listed.requirements[0]?.state).toBe("revoked");
    expect(JSON.stringify(listed)).not.toContain("refresh-token-secret-456");
  });

  it("updates capability readiness from the probe source", async () => {
    const sut = harness.service([capabilityRequirement()]);

    harness.setCapabilities([
      {
        id: "demo.runtime",
        status: "unavailable",
        reason: "missing_setup",
        message: "Credential is missing.",
      },
    ]);
    expect((await sut.list()).requirements[0]).toMatchObject({
      state: "unavailable",
      reason: "capability_unavailable",
    });

    harness.setCapabilities([{ id: "demo.runtime", status: "ready" }]);
    expect((await sut.refresh("demo", "runtime"))).toMatchObject({
      ok: true,
      status: { state: "ready", reason: "capability_ready" },
    });
  });
});
