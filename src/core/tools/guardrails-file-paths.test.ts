import { describe, expect, it } from "vitest";
import { classifyRisk } from "./guardrails.js";

describe("file path risk classification", () => {
  it("classifies multi_edit entries outside the project from their declared path field", () => {
    const result = classifyRisk("multi_edit", {
      edits: [{ path: "/etc/passwd", old_string: "root", new_string: "agent" }],
    });

    expect(result.risk).toBe("dangerous");
    expect(result.reason).toContain("outside project directory");
    expect(result.reason).not.toContain("/etc/passwd");
  });

  it("classifies an outside-project find_replace glob as dangerous", () => {
    const result = classifyRisk("find_replace", {
      pattern: "old",
      replacement: "new",
      files: "/etc/*.conf",
    });

    expect(result.risk).toBe("dangerous");
    expect(result.reason).toContain("outside project directory");
    expect(result.reason).not.toContain("/etc");
  });
});
