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

  it("stays under 7200 characters to keep token cost manageable", () => {
    // ~7200 chars ≈ ~1800 tokens, cached at 0.1x. Budget raised for data handoff guidance.
    expect(SYSTEM_PROMPT.length).toBeLessThan(7200);
  });

  it("includes data handoff guidance for efficient multi-tool pipelines", () => {
    expect(SYSTEM_PROMPT).toContain("Data handoff via files");
    expect(SYSTEM_PROMPT).toContain("save_to");
    expect(SYSTEM_PROMPT).toContain("code_exec reads");
    expect(SYSTEM_PROMPT).toContain("Progressive detail");
  });

  it("includes tool selection heuristics and enable_tools alias guidance", () => {
    expect(SYSTEM_PROMPT).toContain("Selection");
    expect(SYSTEM_PROMPT).toContain("multi_edit for batch");
    expect(SYSTEM_PROMPT).toContain("web_fetch for readable pages");
    expect(SYSTEM_PROMPT).toContain("aliases resolve automatically");
  });

  it("starts with agent identity", () => {
    expect(SYSTEM_PROMPT).toMatch(/^You are KOTA/);
  });

  it("includes error recovery patterns for common tool failures", () => {
    expect(SYSTEM_PROMPT).toContain("Tool fails");
    expect(SYSTEM_PROMPT).toContain("pip install");
    expect(SYSTEM_PROMPT).toContain("web_fetch empty");
  });

  it("error recovery covers file_edit, shell, and stuck-loop patterns", () => {
    expect(SYSTEM_PROMPT).toContain("file_edit match failed");
    expect(SYSTEM_PROMPT).toContain("fuzzy-match suggestion");
    expect(SYSTEM_PROMPT).toContain("shell fails");
    expect(SYSTEM_PROMPT).toContain("read stderr");
    expect(SYSTEM_PROMPT).toContain("Stuck after 3 attempts");
    expect(SYSTEM_PROMPT).not.toContain("auto-installs");
  });

  it("error recovery guides explicit package installation, not auto-install", () => {
    expect(SYSTEM_PROMPT).toContain("pip install <pkg>");
    expect(SYSTEM_PROMPT).toContain("error output names the missing package");
    expect(SYSTEM_PROMPT).toContain("Don't retry the same failing call");
  });

  it("task composition section guides multi-workflow tasks", () => {
    expect(SYSTEM_PROMPT).toContain("Enable tools proactively");
    expect(SYSTEM_PROMPT).toContain("Create artifacts");
    expect(SYSTEM_PROMPT).toContain("Iterate on quality");
    expect(SYSTEM_PROMPT).toContain("Identify sub-workflows");
  });

  it("writing section includes revision and tone guidance", () => {
    expect(SYSTEM_PROMPT).toContain("Match tone to context");
    expect(SYSTEM_PROMPT).toContain("Revise before delivering");
  });

  it("planning section includes dependency tracking and evidence-based estimates", () => {
    expect(SYSTEM_PROMPT).toContain("dependencies, parallel tracks, and milestones");
    expect(SYSTEM_PROMPT).toContain("Ground estimates in evidence");
  });

  it("task composition includes source citation and format guidance", () => {
    expect(SYSTEM_PROMPT).toContain("Cite sources");
    expect(SYSTEM_PROMPT).toContain("Format for the medium");
  });

  it("includes safety guardrails", () => {
    expect(SYSTEM_PROMPT).toContain("destructive commands");
    expect(SYSTEM_PROMPT).toContain("ask_user");
    expect(SYSTEM_PROMPT).toContain("outside the project directory");
  });
});
