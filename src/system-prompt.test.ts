import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT } from "./system-prompt.js";

describe("SYSTEM_PROMPT", () => {
  it("contains all required sections", () => {
    const sections = [
      "## Approach",
      "## Workflow Patterns",
      "## Task Composition",
      "## Tools",
      "## Delegation",
      "## Efficiency",
      "## Error recovery",
      "## Safety",
    ];
    for (const section of sections) {
      expect(SYSTEM_PROMPT).toContain(section);
    }
  });

  it("contains workflow subsections for all task types", () => {
    const workflows = [
      "### Research & Investigation",
      "### Multi-Step Implementation",
      "### Data Analysis",
      "### Writing & Composition",
      "### Planning & Strategy",
      "### Automation & Monitoring",
      "### Debugging & Diagnosis",
    ];
    for (const workflow of workflows) {
      expect(SYSTEM_PROMPT).toContain(workflow);
    }
  });

  it("references all 18 built-in tool names", () => {
    const toolNames = [
      "shell", "file_read", "file_write", "file_edit", "multi_edit",
      "grep", "glob", "todo", "repo_map", "delegate",
      "web_fetch", "memory", "web_search", "ask_user",
      "http_request", "process", "code_exec", "find_replace",
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

  it("task composition section guides multi-workflow tasks", () => {
    expect(SYSTEM_PROMPT).toContain("Enable tools proactively");
    expect(SYSTEM_PROMPT).toContain("Create artifacts");
    expect(SYSTEM_PROMPT).toContain("Iterate on quality");
    expect(SYSTEM_PROMPT).toContain("Identify sub-workflows");
  });

  it("includes safety guardrails", () => {
    expect(SYSTEM_PROMPT).toContain("destructive commands");
    expect(SYSTEM_PROMPT).toContain("ask_user");
    expect(SYSTEM_PROMPT).toContain("outside the project directory");
  });
});
