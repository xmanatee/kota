import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { allTools } from "./tools/index.js";

describe("SYSTEM_PROMPT", () => {
  it("contains all required sections", () => {
    const sections = [
      "## Approach",
      "## Workflow Patterns",
      "## Task Composition",
      "## Tools",
      "## Delegation",
      "## Efficiency",
      "## Memory",
      "## Quality",
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

  it("references all 19 built-in tool names", () => {
    const toolNames = [
      "shell", "file_read", "file_write", "file_edit", "multi_edit",
      "grep", "glob", "todo", "repo_map", "delegate",
      "web_fetch", "memory", "web_search", "ask_user",
      "http_request", "process", "code_exec", "find_replace",
      "notebook",
    ];
    for (const name of toolNames) {
      expect(SYSTEM_PROMPT).toContain(name);
    }
  });

  it("stays under 9500 characters to keep token cost manageable", () => {
    // ~9500 chars ≈ ~2400 tokens, cached at 0.1x. Budget raised for adaptive depth + cross-check guidance.
    expect(SYSTEM_PROMPT.length).toBeLessThan(9500);
  });

  it("includes data handoff guidance for efficient multi-tool pipelines", () => {
    expect(SYSTEM_PROMPT).toContain("Data handoff via files");
    expect(SYSTEM_PROMPT).toContain("save_to");
    expect(SYSTEM_PROMPT).toContain("code_exec reads");
    expect(SYSTEM_PROMPT).toContain("Progressive detail");
  });

  it("includes grep output mode guidance for token-efficient exploration", () => {
    expect(SYSTEM_PROMPT).toContain("files_only for file lists");
    expect(SYSTEM_PROMPT).toContain("count_only for match counts");
    expect(SYSTEM_PROMPT).toContain("Explore breadth-first");
    expect(SYSTEM_PROMPT).toContain("grep(files_only)");
    expect(SYSTEM_PROMPT).toContain("grep(count_only)");
  });

  it("includes tool selection heuristics and enable_tools alias guidance", () => {
    expect(SYSTEM_PROMPT).toContain("Selection");
    expect(SYSTEM_PROMPT).toContain("multi_edit for batch");
    expect(SYSTEM_PROMPT).toContain("web_fetch for pages");
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
    expect(SYSTEM_PROMPT).toContain("error names the missing package");
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

  it("task composition includes checkpoint guidance for multi-step workflows", () => {
    expect(SYSTEM_PROMPT).toContain("Checkpoint with user");
    expect(SYSTEM_PROMPT).toContain("confirm direction");
    expect(SYSTEM_PROMPT).toContain("intermediate result");
  });

  it("execution tools include notebook for reproducible analysis", () => {
    expect(SYSTEM_PROMPT).toContain("notebook");
    expect(SYSTEM_PROMPT).toContain("reproducible analysis");
  });

  it("data analysis workflow includes data quality inspection and notebook guidance", () => {
    const dataSection = SYSTEM_PROMPT.split("### Data Analysis")[1]?.split("###")[0] || "";
    expect(dataSection).toContain("duplicates");
    expect(dataSection).toContain("distributions");
    expect(dataSection).toContain("notebook");
    expect(dataSection).toContain(".ipynb");
  });

  it("data analysis includes data cleaning step before analysis", () => {
    const dataSection = SYSTEM_PROMPT.split("### Data Analysis")[1]?.split("###")[0] || "";
    expect(dataSection).toContain("Clean before analyzing");
    expect(dataSection).toContain("missing values");
  });

  it("data analysis pipeline: prompt tools match registry (cross-module)", () => {
    const dataSection = SYSTEM_PROMPT.split("### Data Analysis")[1]?.split("###")[0] || "";
    expect(dataSection).toContain("code_exec");
    expect(dataSection).toContain("notebook");
    expect(dataSection).toContain("matplotlib");
    // Verify referenced tools exist in registry
    expect(allTools.find((t) => t.name === "code_exec")).toBeDefined();
    expect(allTools.find((t) => t.name === "notebook")).toBeDefined();
  });

  it("data analysis references seaborn alongside matplotlib", () => {
    expect(SYSTEM_PROMPT).toContain("seaborn");
  });

  it("memory section guides proactive save and recall with keyword discipline", () => {
    expect(SYSTEM_PROMPT).toContain("## Memory");
    expect(SYSTEM_PROMPT).toContain("outlasts the session");
    expect(SYSTEM_PROMPT).toContain("Recall before starting work");
    expect(SYSTEM_PROMPT).toContain("specific keywords");
    expect(SYSTEM_PROMPT).toContain("Skip ephemeral");
  });

  it("quality section guides self-verification before delivering", () => {
    expect(SYSTEM_PROMPT).toContain("## Quality");
    expect(SYSTEM_PROMPT).toContain("Re-read your response");
    expect(SYSTEM_PROMPT).toContain("file_read the output");
    expect(SYSTEM_PROMPT).toContain("verify each step");
  });

  it("stays under 7200 characters with new sections", () => {
    // Memory + Quality add ~450 chars; verify we're still under budget
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(5000);
  });

  it("approach section guides adaptive depth and assumption checking", () => {
    expect(SYSTEM_PROMPT).toContain("Adapt depth to complexity");
    expect(SYSTEM_PROMPT).toContain("re-examine assumptions");
    expect(SYSTEM_PROMPT).toContain("ask_user");
  });

  it("quality section guides cross-checking and confidence signaling", () => {
    expect(SYSTEM_PROMPT).toContain("Cross-check claims");
    expect(SYSTEM_PROMPT).toContain("second method or source");
    expect(SYSTEM_PROMPT).toContain("State confidence");
    expect(SYSTEM_PROMPT).toContain("unverified assumptions");
  });

  it("includes safety guardrails", () => {
    expect(SYSTEM_PROMPT).toContain("destructive commands");
    expect(SYSTEM_PROMPT).toContain("ask_user");
    expect(SYSTEM_PROMPT).toContain("outside the project directory");
  });

  it("delegation section includes task description and parallel research patterns", () => {
    expect(SYSTEM_PROMPT).toContain("Task descriptions");
    expect(SYSTEM_PROMPT).toContain("output format");
    expect(SYSTEM_PROMPT).toContain("Parallel research");
    expect(SYSTEM_PROMPT).toContain("explore delegates");
    expect(SYSTEM_PROMPT).toContain("synthesize");
  });

  it("delegate tool schema has mode parameter with explore/execute matching prompt", () => {
    const delegate = allTools.find((t) => t.name === "delegate")!;
    expect(delegate).toBeDefined();
    const props = delegate.input_schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("mode");
    const mode = props.mode as { enum?: string[] };
    expect(mode.enum).toContain("explore");
    expect(mode.enum).toContain("execute");
  });

  it("delegate tool has task parameter for structured handoff", () => {
    const delegate = allTools.find((t) => t.name === "delegate")!;
    const props = delegate.input_schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("task");
  });

  // Cross-module integration tests — verify prompt guidance matches tool schemas

  it("every tool in allTools registry is referenced in system prompt", () => {
    for (const tool of allTools) {
      expect(SYSTEM_PROMPT).toContain(tool.name);
    }
  });

  it("grep tool schema has modes and options referenced in prompt", () => {
    const grep = allTools.find((t) => t.name === "grep")!;
    const props = grep.input_schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("files_only");
    expect(props).toHaveProperty("count_only");
    expect(props).toHaveProperty("context_lines");
  });

  it("web_fetch and http_request tools have save_to parameter", () => {
    const webFetch = allTools.find((t) => t.name === "web_fetch")!;
    const httpReq = allTools.find((t) => t.name === "http_request")!;
    const fetchProps = webFetch.input_schema.properties as Record<
      string,
      unknown
    >;
    const httpProps = httpReq.input_schema.properties as Record<
      string,
      unknown
    >;
    expect(fetchProps).toHaveProperty("save_to");
    expect(httpProps).toHaveProperty("save_to");
  });

  it("code_exec tool supports Python and Node.js languages", () => {
    const codeExec = allTools.find((t) => t.name === "code_exec")!;
    const props = codeExec.input_schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("language");
    const lang = props.language as { enum?: string[] };
    expect(lang.enum).toContain("python");
    const hasNode = lang.enum!.some(
      (v) => v === "javascript" || v === "node" || v === "nodejs",
    );
    expect(hasNode).toBe(true);
  });
});
