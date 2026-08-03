import { describe, expect, it } from "vitest";
import {
  normalizeGeneratedTaskScalar,
  renderGeneratedTaskProse,
} from "./generated-task-text.js";

describe("generated task text", () => {
  it("normalizes frontmatter scalars to one control-free line", () => {
    expect(
      normalizeGeneratedTaskScalar(
        "test task",
        "title",
        "  Fix auth\nstatus: done\u0000  ",
      ),
    ).toBe("Fix auth status: done");
  });

  it("indents body prose so agent headings remain prose", () => {
    expect(renderGeneratedTaskProse("Evidence\n## Injected")).toBe(
      "    Evidence\n    ## Injected",
    );
  });

  it("rejects empty body prose instead of writing a placeholder", () => {
    expect(() => renderGeneratedTaskProse(" \u0000 ")).toThrow(
      "generated task prose is empty after normalization",
    );
  });
});
