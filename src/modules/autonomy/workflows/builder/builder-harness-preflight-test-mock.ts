import { vi } from "vitest";
import { getPreset, resolveTierModel } from "#core/model/preset.js";

vi.mock("./builder-harness-preflight.js", () => ({
  runBuilderHarnessPreflight: vi.fn(() => ({
    harness: "codex",
    model: resolveTierModel(getPreset("codex"), "capable"),
    effort: "xhigh",
    ready: true,
    artifactPath:
      ".kota/runs/harness/steps/builder-preclaim.harness-capability.json",
  })),
}));
