import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT } from "./system-prompt.js";

describe("SYSTEM_PROMPT", () => {
  it("contains all required sections", () => {
    const sections = [
      "## Approach",
      "## Workflow Patterns",
      "## Tools",
      "## Delegation",
      "## Output Quality",
      "## Efficiency",
      "## Error recovery",
      "## Safety",
    ];
    for (const section of sections) {
      expect(SYSTEM_PROMPT).toContain(section);
    }
  });

  it("contains workflow subsections for research, implementation, and analysis", () => {
    expect(SYSTEM_PROMPT).toContain("### Research & Investigation");
    expect(SYSTEM_PROMPT).toContain("### Multi-Step Implementation");
    expect(SYSTEM_PROMPT).toContain("### Data Analysis");
  });

  it("references all 17 built-in tool names", () => {
    const toolNames = [
      "shell", "file_read", "file_write", "file_edit", "multi_edit",
      "grep", "glob", "todo", "repo_map", "delegate",
      "web_fetch", "memory", "web_search", "ask_user",
      "http_request", "process", "code_exec",
    ];
    for (const name of toolNames) {
      expect(SYSTEM_PROMPT).toContain(name);
    }
  });

  it("stays under 6000 characters to keep token cost manageable", () => {
    // ~6000 chars ≈ ~1500 tokens, cached at 0.1x. Keep it lean.
    expect(SYSTEM_PROMPT.length).toBeLessThan(6000);
  });

  it("starts with agent identity", () => {
    expect(SYSTEM_PROMPT).toMatch(/^You are KOTA/);
  });

  it("includes error recovery patterns for common tool failures", () => {
    expect(SYSTEM_PROMPT).toContain("file_edit fails");
    expect(SYSTEM_PROMPT).toContain("shell command fails");
    expect(SYSTEM_PROMPT).toContain("code_exec import error");
    expect(SYSTEM_PROMPT).toContain("web_fetch returns empty");
  });

  it("includes safety guardrails", () => {
    expect(SYSTEM_PROMPT).toContain("destructive commands");
    expect(SYSTEM_PROMPT).toContain("ask_user");
    expect(SYSTEM_PROMPT).toContain("outside the project directory");
  });
});
