import { afterEach, describe, expect, it } from "vitest";
import type { ToolDef } from "#core/modules/module-types.js";
import { resolveAutonomyGate } from "#core/tools/autonomy-mode.js";
import { riskFromEffect } from "#core/tools/effect.js";
import { assess, classifyRisk, getDefaultConfig } from "#core/tools/guardrails.js";
import { clearCustomTools, registerTool } from "#core/tools/index.js";
import executionModule from "./index.js";

function contributedTools(): ToolDef[] {
  return Array.isArray(executionModule.tools) ? executionModule.tools : [];
}

function computerUseTool(): ToolDef {
  const tool = contributedTools().find((entry) => entry.tool.name === "computer_use");
  if (!tool) {
    throw new Error("execution module did not contribute computer_use");
  }
  return tool;
}

function registerComputerUseForGuardrails(): void {
  const entry = computerUseTool();
  registerTool(
    entry.tool,
    async () => ({ content: "not invoked" }),
    executionModule.name,
    { effect: entry.effect },
  );
}

describe("execution module", () => {
  afterEach(() => clearCustomTools());

  it("classifies computer_use as a dangerous GUI actuator", () => {
    const entry = computerUseTool();

    expect(entry.effect).toEqual({
      kind: "destructive",
      scope: "operator-surface",
      idempotent: false,
      openWorld: true,
    });
    expect(riskFromEffect(entry.effect)).toBe("dangerous");
  });

  it("routes computer_use through passive denial and supervised approval", () => {
    registerComputerUseForGuardrails();

    const classification = classifyRisk("computer_use", {});
    expect(classification.risk).toBe("dangerous");

    const assessment = assess("computer_use", {}, getDefaultConfig());
    expect(resolveAutonomyGate("passive", assessment).action).toBe("deny");
    expect(resolveAutonomyGate("supervised", assessment).action).toBe("queue");
  });
});
