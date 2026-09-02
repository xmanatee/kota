import { describe, expect, it } from "vitest";
import {
  decodeScopeOnboardingAcceptedPlan,
  decodeScopeOnboardingPlanRequest,
} from "./scope-onboarding-codec.js";

describe("scope onboarding control decoder", () => {
  it("decodes explicit plan choices at the public daemon boundary", () => {
    expect(decodeScopeOnboardingPlanRequest({
      directoryRoot: "/tmp/external",
      choices: {
        displayName: "External",
        trust: true,
        initialAutomationMode: "supervised",
        writes: { mode: "scope-directory" },
      },
    })).toEqual({
      ok: true,
      value: {
        directoryRoot: "/tmp/external",
        choices: {
          displayName: "External",
          trust: true,
          initialAutomationMode: "supervised",
          writes: { mode: "scope-directory" },
        },
      },
    });
  });

  it("rejects incomplete or widened accepted-plan receipts", () => {
    expect(decodeScopeOnboardingAcceptedPlan({
      planId: "plan-1",
      operationId: "onboard_111111111111111111111111",
      inspectionId: "inspection-1",
      directoryRoot: "/tmp/external",
      createdAt: "2026-09-02T00:00:00.000Z",
      choices: {
        displayName: "External",
        trust: true,
        initialAutomationMode: "autonomous",
        writes: { mode: "unrestricted" },
        bypassAuthority: true,
      },
    })).toMatchObject({
      ok: false,
      error: expect.stringContaining("unknown field bypassAuthority"),
    });
    expect(decodeScopeOnboardingAcceptedPlan({
      planId: "plan-1",
      operationId: "onboard_111111111111111111111111",
      inspectionId: "inspection-1",
      directoryRoot: "/tmp/external",
      createdAt: "2026-09-02T00:00:00.000Z",
      choices: { trust: false },
    })).toMatchObject({
      ok: false,
      error: expect.stringContaining("displayName is required"),
    });
  });
});
