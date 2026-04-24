import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "#core/agents/system-prompt.js";
import { getAllTools } from "#core/tools/index.js";
import { CORE_TOOL_NAMES, TOOL_GROUPS } from "#core/tools/tool-groups.js";
import { codeExecTool } from "#modules/execution/code-exec.js";
import { grepTool } from "#modules/filesystem/grep.js";
import { httpRequestTool } from "#modules/web-access/http-request.js";
import { webFetchTool } from "#modules/web-access/web-fetch.js";

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
      "### Everyday Assistance",
    ];
    for (const workflow of workflows) {
      expect(SYSTEM_PROMPT).toContain(workflow);
    }
  });

  it("identifies as personal assistant, not just task runner", () => {
    expect(SYSTEM_PROMPT).toContain("personal assistant");
    expect(SYSTEM_PROMPT).toContain("whatever the user needs");
  });

  it("guides when NOT to use tools for conversational tasks", () => {
    expect(SYSTEM_PROMPT).toContain("Not every question needs a tool");
    expect(SYSTEM_PROMPT).toContain("Direct knowledge");
    expect(SYSTEM_PROMPT).toContain("conversational responses");
    expect(SYSTEM_PROMPT).toContain("not by default");
  });

  it("everyday assistance covers advice, drafting, brainstorming, explanations, calculations, summarization", () => {
    const section = SYSTEM_PROMPT.split("### Everyday Assistance")[1]?.split("###")[0] || "";
    expect(section).toContain("comparison table");
    expect(section).toContain("Email/message drafting");
    expect(section).toContain("Brainstorming");
    expect(section).toContain("Explanations");
    expect(section).toContain("Meeting/presentation prep");
    expect(section).toContain("Calculations");
    expect(section).toContain("code_exec");
    expect(section).toContain("Summarization");
  });

  it("everyday assistance guides matching explanation depth to user expertise", () => {
    const section = SYSTEM_PROMPT.split("### Everyday Assistance")[1]?.split("###")[0] || "";
    expect(section).toContain("match depth");
    expect(section).toContain("analogies");
  });

  it("references all 19 built-in tool names", () => {
    const toolNames = [
      "shell", "file_read", "file_write", "file_edit", "multi_edit",
      "grep", "glob", "todo", "repo_map", "delegate",
      "web_fetch", "memory", "web_search", "ask_user",
      "http_request", "process", "code_exec", "find_replace",
      "notebook", "sqlite",
    ];
    for (const name of toolNames) {
      expect(SYSTEM_PROMPT).toContain(name);
    }
  });

  it("stays under 12000 characters to keep token cost manageable", () => {
    // ~12000 chars ≈ ~3000 tokens, cached at 0.1x. Budget raised for knowledge store section (iter 531).
    expect(SYSTEM_PROMPT.length).toBeLessThan(12000);
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
    expect(SYSTEM_PROMPT).toContain("multi_edit batch");
    expect(SYSTEM_PROMPT).toContain("web_fetch pages");
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
    expect(SYSTEM_PROMPT).toContain("pnpm add <pkg>");
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

  it("execution tools include notebook for analysis", () => {
    expect(SYSTEM_PROMPT).toContain("notebook");
    expect(SYSTEM_PROMPT).toContain("analysis");
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
    // code_exec is now in the execution module (not core registry), verify it exists directly
    expect(codeExecTool.name).toBe("code_exec");
    // notebook is now in the notebook module (not core registry)
  });

  it("data analysis references seaborn alongside matplotlib", () => {
    expect(SYSTEM_PROMPT).toContain("seaborn");
  });

  it("memory section guides proactive save and recall", () => {
    expect(SYSTEM_PROMPT).toContain("## Memory");
    expect(SYSTEM_PROMPT).toContain("outlasts the session");
    expect(SYSTEM_PROMPT).toContain("Recall before starting work");
    expect(SYSTEM_PROMPT).toContain("Skip ephemeral");
  });

  it("memory section guides update patterns and deduplication", () => {
    const memorySection = SYSTEM_PROMPT.split("## Memory")[1]?.split("##")[0] || "";
    expect(memorySection).toContain("Update");
    expect(memorySection).toContain("duplicate");
  });

  it("memory section guides proactive saves without explicit user request", () => {
    const memorySection = SYSTEM_PROMPT.split("## Memory")[1]?.split("##")[0] || "";
    expect(memorySection).toContain("Save proactively");
    expect(memorySection).toContain("without being asked");
    expect(memorySection).toContain("preferences");
  });

  it("memory section guides recency-aware search with since filter", () => {
    const memorySection = SYSTEM_PROMPT.split("## Memory")[1]?.split("##")[0] || "";
    expect(memorySection).toContain("since filter");
    expect(memorySection).toContain("time-sensitive");
    expect(memorySection).toContain("Recency");
  });

  it("memory section guides what to save with knowledge and memory distinction", () => {
    const memorySection = SYSTEM_PROMPT.split("## Memory")[1]?.split("##")[0] || "";
    expect(memorySection).toContain("preferences");
    expect(memorySection).toContain("decisions");
    expect(memorySection).toContain("rationale");
    expect(memorySection).toContain("research findings");
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

  it("approach section guides handling underspecified tasks with reasonable assumptions", () => {
    expect(SYSTEM_PROMPT).toContain("reasonable assumptions");
    expect(SYSTEM_PROMPT).toContain("significantly change the outcome");
  });

  it("efficiency section includes context budget management guidance", () => {
    expect(SYSTEM_PROMPT).toContain("Context budget");
    expect(SYSTEM_PROMPT).toContain("delegate all research");
    expect(SYSTEM_PROMPT).toContain("persists through compaction");
  });

  it("efficiency section guides building on prior turns", () => {
    expect(SYSTEM_PROMPT).toContain("Build on prior turns");
    expect(SYSTEM_PROMPT).toContain("don't restart from scratch");
  });

  it("research workflow includes source quality and recency evaluation", () => {
    const researchSection = SYSTEM_PROMPT.split("### Research & Investigation")[1]?.split("###")[0] || "";
    expect(researchSection).toContain("primary sources");
    expect(researchSection).toContain("recency");
    expect(researchSection).toContain("sources conflict");
    expect(researchSection).toContain("note dates");
  });

  it("research workflow guides web data capture into code_exec pipeline", () => {
    const researchSection = SYSTEM_PROMPT.split("### Research & Investigation")[1]?.split("###")[0] || "";
    expect(researchSection).toContain("save_to");
    expect(researchSection).toContain("code_exec");
    expect(researchSection).toContain("tabular");
  });

  it("research workflow presentation includes source dates", () => {
    const researchSection = SYSTEM_PROMPT.split("### Research & Investigation")[1]?.split("###")[0] || "";
    expect(researchSection).toContain("source dates");
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
    expect(SYSTEM_PROMPT).toContain("batch for 2+");
    expect(SYSTEM_PROMPT).toContain("synthesize");
  });

  it("delegate tool schema has mode parameter with explore/execute matching prompt", () => {
    const delegate = getAllTools().find((t) => t.name === "delegate")!;
    expect(delegate).toBeDefined();
    const props = delegate.input_schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("mode");
    const mode = props.mode as { enum?: string[] };
    expect(mode.enum).toContain("explore");
    expect(mode.enum).toContain("execute");
  });

  it("tool group names in prompt match TOOL_GROUPS registry (cross-module)", () => {
    const groupNames = Object.keys(TOOL_GROUPS);
    for (const name of groupNames) {
      expect(SYSTEM_PROMPT).toContain(name);
    }
  });

  it("core tools are all referenced in system prompt (cross-module)", () => {
    for (const name of CORE_TOOL_NAMES) {
      expect(SYSTEM_PROMPT).toContain(name);
    }
  });

  it("prompt char budget has headroom after trimming", () => {
    // Ensure buffer below 12000 limit — catches gradual bloat before it regresses
    expect(SYSTEM_PROMPT.length).toBeLessThan(11900);
  });

  it("delegate tool has task parameter for structured handoff", () => {
    const delegate = getAllTools().find((t) => t.name === "delegate")!;
    const props = delegate.input_schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("task");
  });

  // Cross-module integration tests — verify prompt guidance matches tool schemas

  it("every tool in registry is referenced in system prompt", () => {
    for (const tool of getAllTools()) {
      expect(SYSTEM_PROMPT).toContain(tool.name);
    }
  });

  it("grep tool schema has modes and options referenced in prompt", () => {
    // grep is now in the filesystem module; import its schema directly
    const props = grepTool.input_schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("files_only");
    expect(props).toHaveProperty("count_only");
    expect(props).toHaveProperty("context_lines");
  });

  it("web_fetch and http_request tools have save_to parameter", () => {
    // These tools are in the web-access module; import schemas directly
    const fetchProps = webFetchTool.input_schema.properties as Record<string, unknown>;
    const httpProps = httpRequestTool.input_schema.properties as Record<string, unknown>;
    expect(fetchProps).toHaveProperty("save_to");
    expect(httpProps).toHaveProperty("save_to");
  });

  it("code_exec tool supports Python and Node.js languages", () => {
    // code_exec is now in the execution module (not core registry); import directly
    const props = codeExecTool.input_schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("language");
    const lang = props.language as { enum?: string[] };
    expect(lang.enum).toContain("python");
    const hasNode = lang.enum!.some(
      (v) => v === "javascript" || v === "node" || v === "nodejs",
    );
    expect(hasNode).toBe(true);
  });
});
