import { describe, expect, it } from "vitest";
import {
  AUTONOMY_MODES,
  isAutonomyMode,
  resolveAutonomyGate,
  supervisedGuardrailsConfig,
} from "./autonomy-mode.js";
import type { Assessment } from "./guardrails.js";

function assessment(
  risk: Assessment["risk"],
  overrides: Partial<Assessment> = {},
): Assessment {
  return {
    tool: "shell",
    risk,
    policy: "allow",
    reason: "test",
    ...overrides,
  };
}

describe("isAutonomyMode", () => {
  it("accepts each declared mode", () => {
    for (const mode of AUTONOMY_MODES) {
      expect(isAutonomyMode(mode)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isAutonomyMode("")).toBe(false);
    expect(isAutonomyMode("AUTONOMOUS")).toBe(false);
    expect(isAutonomyMode(undefined)).toBe(false);
    expect(isAutonomyMode(null)).toBe(false);
    expect(isAutonomyMode(0)).toBe(false);
  });
});

describe("resolveAutonomyGate", () => {
  it("always allows safe tools regardless of mode", () => {
    for (const mode of AUTONOMY_MODES) {
      expect(resolveAutonomyGate(mode, assessment("safe")).action).toBe("allow");
    }
  });

  it("autonomous mode passes non-safe tools through to policy layer", () => {
    expect(resolveAutonomyGate("autonomous", assessment("moderate")).action).toBe("allow");
    expect(resolveAutonomyGate("autonomous", assessment("dangerous")).action).toBe("allow");
  });

  it("passive mode denies any non-safe tool with a human-readable message", () => {
    const moderate = resolveAutonomyGate("passive", assessment("moderate"));
    expect(moderate.action).toBe("deny");
    if (moderate.action === "deny") {
      expect(moderate.message).toMatch(/passive/);
      expect(moderate.message).toMatch(/shell/);
    }

    const dangerous = resolveAutonomyGate("passive", assessment("dangerous"));
    expect(dangerous.action).toBe("deny");
  });

  it("supervised mode queues any non-safe tool regardless of risk level", () => {
    const moderate = resolveAutonomyGate("supervised", assessment("moderate"));
    expect(moderate.action).toBe("queue");
    if (moderate.action === "queue") {
      expect(moderate.reason).toMatch(/supervised/);
    }

    const dangerous = resolveAutonomyGate("supervised", assessment("dangerous"));
    expect(dangerous.action).toBe("queue");
  });
});

describe("supervisedGuardrailsConfig", () => {
  it("forces non-safe policies to queue while preserving safe policy", () => {
    const result = supervisedGuardrailsConfig({
      policies: { safe: "allow", moderate: "allow", dangerous: "confirm" },
      approvalTimeoutMs: 10_000,
    });
    expect(result.policies).toEqual({
      safe: "allow",
      moderate: "queue",
      dangerous: "queue",
    });
    expect(result.approvalTimeoutMs).toBe(10_000);
  });
});
