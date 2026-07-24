import { describe, expect, it } from "vitest";
import { detectObservabilityObligationReview } from "./observability-obligation.js";

function diffFor(file: string, addedLines: readonly string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    "index 0000001..0000002 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,1 +1,${Math.max(addedLines.length, 1)} @@`,
    ...addedLines.map((line) => `+${line}`),
  ].join("\n");
}

describe("observability obligation tool-effect evidence", () => {
  it("maps focused risk assertions to tool-effect resolution changes", () => {
    const assertionFile = "src/core/tools/guardrails-resolved-effects.test.ts";
    const review = detectObservabilityObligationReview(
      [
        diffFor("src/core/tools/module-factory/actions.ts", [
          "registerTool(def.tool, def.runner, manifest.name, {",
          "  effect: def.effect,",
          "  ...(def.resolveEffect ? { resolveEffect: def.resolveEffect } : {}),",
          "});",
        ]),
        diffFor("src/core/tools/tool-effect-registry.ts", [
          "export type ToolEffectMetadata = {",
          "  effect: ToolEffect;",
          "  resolveEffect?: ToolEffectResolver;",
          "};",
          "export function resolveRegisteredToolEffect(name: string) {",
          "  return moduleToolEffects.get(name)?.effect;",
          "}",
        ]),
        diffFor(assertionFile, [
          'it("does not let an invocation resolver lower manifest risk", () => {',
          '  expect(classifyRisk("manifest_guarded_send", {})).toEqual({',
          '    risk: "dangerous",',
          '    reason: "manifest effect is a high-risk operation",',
          "  });",
          "});",
        ]),
      ].join("\n"),
    );

    expect(review.outcome).toBe("ok");
    expect(review.satisfiedFiles).toEqual([
      "src/core/tools/module-factory/actions.ts",
      "src/core/tools/tool-effect-registry.ts",
    ]);
    expect(review.missingFiles).toEqual([]);
    expect(review.candidates.map((candidate) => candidate.evidence)).toEqual([
      [
        expect.objectContaining({
          kind: "focused-test-assertion",
          ref: assertionFile,
        }),
      ],
      [
        expect.objectContaining({
          kind: "focused-test-assertion",
          ref: assertionFile,
        }),
      ],
    ]);
  });
});
