import { describe, expect, it } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { buildWorkflowCommand } from "./index.js";

describe("workflow-ops command", () => {
  it("exposes automation as an alias for the workflow command", () => {
    const command = buildWorkflowCommand({} as ModuleContext);

    expect(command.name()).toBe("workflow");
    expect(command.aliases()).toEqual(["wf", "automation"]);
    expect(command.description()).toContain("automation workflow runs");
  });
});
