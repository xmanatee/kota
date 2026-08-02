import { describe, expect, it } from "vitest";
import { codexAgentHarness } from "./adapter.js";

describe("Codex agent harness scope policy boundary", () => {
  it("declares live KOTA scope policy unsupported", () => {
    expect(
      codexAgentHarness.unsupportedRunOptions?.map((option) => option.option),
    ).toContain("scopePolicy");
  });
});
