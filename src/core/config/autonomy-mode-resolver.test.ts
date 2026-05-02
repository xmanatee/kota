import { describe, expect, it } from "vitest";
import type { AutonomyMode } from "../tools/autonomy-mode.js";
import { resolveChannelAutonomyMode } from "./autonomy-mode-resolver.js";
import type { KotaConfig } from "./config.js";

describe("resolveChannelAutonomyMode", () => {
  it("uses the per-channel override when present", () => {
    const config: KotaConfig = { serve: { defaultAutonomyMode: "passive" } };
    expect(resolveChannelAutonomyMode("autonomous", config, "slack")).toBe("autonomous");
  });

  it("falls back to config.serve.defaultAutonomyMode when channel override is absent", () => {
    const config: KotaConfig = { serve: { defaultAutonomyMode: "passive" } };
    expect(resolveChannelAutonomyMode(undefined, config, "slack")).toBe("passive");
  });

  it("throws a loud error when neither level is set", () => {
    expect(() => resolveChannelAutonomyMode(undefined, {}, "cli")).toThrow(
      /cli: autonomy mode is not configured/,
    );
  });

  it("throws when config itself is undefined and no override is given", () => {
    expect(() => resolveChannelAutonomyMode(undefined, undefined, "telegram")).toThrow(
      /telegram: autonomy mode is not configured/,
    );
  });

  it("rejects a non-enum per-channel override", () => {
    // Cast a malformed value through the typed boundary to exercise the
    // runtime guard. Production callers have a typed `AutonomyMode | undefined`
    // and cannot reach this branch without a similar escape hatch.
    expect(() =>
      resolveChannelAutonomyMode("banana" as AutonomyMode, {}, "slack"),
    ).toThrow(
      /slack: defaultAutonomyMode must be one of passive, supervised, autonomous/,
    );
  });

  it("rejects a non-enum config.serve.defaultAutonomyMode", () => {
    const config = { serve: { defaultAutonomyMode: "banana" } } as unknown as KotaConfig;
    expect(() => resolveChannelAutonomyMode(undefined, config, "vercel")).toThrow(
      /config\.serve\.defaultAutonomyMode must be one of passive, supervised, autonomous/,
    );
  });
});
