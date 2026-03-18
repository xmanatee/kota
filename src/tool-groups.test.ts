import { beforeEach, describe, expect, it } from "vitest";
import {
  CORE_TOOL_NAMES,
  detectToolGroups,
  enableGroup,
  enableToolsTool,
  filterTools,
  getActiveToolNames,
  getEnabledGroups,
  resetGroups,
  runEnableTools,
  TOOL_GROUPS,
} from "./tool-groups.js";

describe("tool-groups", () => {
  beforeEach(() => {
    resetGroups();
  });

  describe("CORE_TOOL_NAMES", () => {
    it("includes essential tools", () => {
      for (const name of ["shell", "file_read", "file_edit", "grep", "glob", "delegate", "enable_tools"]) {
        expect(CORE_TOOL_NAMES.has(name)).toBe(true);
      }
    });

    it("does not include extended tools", () => {
      for (const name of ["web_search", "code_exec", "todo", "multi_edit"]) {
        expect(CORE_TOOL_NAMES.has(name)).toBe(false);
      }
    });

    it("does not include gui, orchestration, or relocated tools", () => {
      for (const name of ["computer_use", "screenshot", "view_image", "clipboard", "batch", "pipe", "map", "notify", "sqlite"]) {
        expect(CORE_TOOL_NAMES.has(name)).toBe(false);
      }
    });
  });

  describe("enableGroup", () => {
    it("enables a valid group and returns its tools", () => {
      const result = enableGroup("web");
      expect(result.error).toBeUndefined();
      expect(result.tools).toEqual(["web_search", "web_fetch", "http_request"]);
      expect(getEnabledGroups()).toEqual(["web"]);
    });

    it("enables all groups at once", () => {
      const result = enableGroup("all");
      expect(result.error).toBeUndefined();
      expect(result.tools.length).toBeGreaterThan(0);
      expect(getEnabledGroups()).toEqual(Object.keys(TOOL_GROUPS).sort());
    });

    it("returns error for unknown group", () => {
      const result = enableGroup("nonexistent");
      expect(result.error).toContain("Unknown group or tool");
      expect(result.tools).toEqual([]);
    });

    it("resolves tool name to parent group", () => {
      const result = enableGroup("web_search");
      expect(result.error).toBeUndefined();
      expect(result.tools).toEqual(["web_search", "web_fetch", "http_request"]);
      expect(getEnabledGroups()).toEqual(["web"]);
    });

    it("resolves code_exec to code group", () => {
      const result = enableGroup("code_exec");
      expect(result.error).toBeUndefined();
      expect(result.tools).toEqual(["code_exec", "notebook", "sqlite"]);
      expect(getEnabledGroups()).toEqual(["code"]);
    });

    it("resolves todo to management group", () => {
      const result = enableGroup("todo");
      expect(result.error).toBeUndefined();
      expect(result.tools).toContain("todo");
      expect(getEnabledGroups()).toEqual(["management"]);
    });

    it("enables gui group with visual tools", () => {
      const result = enableGroup("gui");
      expect(result.error).toBeUndefined();
      expect(result.tools).toEqual(["computer_use", "screenshot", "view_image", "clipboard"]);
      expect(getEnabledGroups()).toEqual(["gui"]);
    });

    it("enables orchestration group with composition tools", () => {
      const result = enableGroup("orchestration");
      expect(result.error).toBeUndefined();
      expect(result.tools).toEqual(["batch", "pipe", "map", "workspace"]);
      expect(getEnabledGroups()).toEqual(["orchestration"]);
    });

    it("resolves batch to orchestration group", () => {
      const result = enableGroup("batch");
      expect(result.error).toBeUndefined();
      expect(result.tools).toEqual(["batch", "pipe", "map", "workspace"]);
      expect(getEnabledGroups()).toEqual(["orchestration"]);
    });

    it("resolves screenshot to gui group", () => {
      const result = enableGroup("screenshot");
      expect(result.error).toBeUndefined();
      expect(result.tools).toEqual(["computer_use", "screenshot", "view_image", "clipboard"]);
      expect(getEnabledGroups()).toEqual(["gui"]);
    });

    it("management group includes notify", () => {
      const result = enableGroup("management");
      expect(result.error).toBeUndefined();
      expect(result.tools).toContain("notify");
      expect(result.tools).toContain("todo");
    });

    it("is idempotent — enabling same group twice does not duplicate", () => {
      enableGroup("web");
      enableGroup("web");
      expect(getEnabledGroups()).toEqual(["web"]);
    });
  });

  describe("getActiveToolNames", () => {
    it("returns only core tools by default", () => {
      const active = getActiveToolNames();
      for (const name of CORE_TOOL_NAMES) {
        expect(active.has(name)).toBe(true);
      }
      expect(active.has("web_search")).toBe(false);
    });

    it("includes group tools after enabling", () => {
      enableGroup("code");
      const active = getActiveToolNames();
      expect(active.has("code_exec")).toBe(true);
    });

    it("includes multiple groups", () => {
      enableGroup("web");
      enableGroup("management");
      const active = getActiveToolNames();
      expect(active.has("web_search")).toBe(true);
      expect(active.has("todo")).toBe(true);
      expect(active.has("code_exec")).toBe(false);
    });
  });

  describe("filterTools", () => {
    const mockTools = [
      { name: "shell", description: "", input_schema: { type: "object" as const, properties: {} } },
      { name: "web_search", description: "", input_schema: { type: "object" as const, properties: {} } },
      { name: "code_exec", description: "", input_schema: { type: "object" as const, properties: {} } },
    ];

    it("keeps core tools and filters extended tools", () => {
      const filtered = filterTools(mockTools);
      const names = filtered.map((t) => t.name);
      expect(names).toContain("shell");
      expect(names).not.toContain("web_search");
      expect(names).not.toContain("code_exec");
    });

    it("always includes enable_tools even when not in input", () => {
      const filtered = filterTools(mockTools);
      expect(filtered.some((t) => t.name === "enable_tools")).toBe(true);
    });

    it("includes enabled group tools", () => {
      enableGroup("web");
      const filtered = filterTools(mockTools);
      const names = filtered.map((t) => t.name);
      expect(names).toContain("shell");
      expect(names).toContain("web_search");
      expect(names).not.toContain("code_exec");
    });

    it("does not duplicate enable_tools if already in input", () => {
      const withEnableTools = [...mockTools, enableToolsTool];
      const filtered = filterTools(withEnableTools);
      const count = filtered.filter((t) => t.name === "enable_tools").length;
      expect(count).toBe(1);
    });
  });

  describe("resetGroups", () => {
    it("clears all enabled groups", () => {
      enableGroup("web");
      enableGroup("code");
      resetGroups();
      expect(getEnabledGroups()).toEqual([]);
      expect(getActiveToolNames().has("web_search")).toBe(false);
    });
  });

  describe("enableToolsTool", () => {
    it("has correct name and lists groups", () => {
      expect(enableToolsTool.name).toBe("enable_tools");
      for (const group of Object.keys(TOOL_GROUPS)) {
        expect(enableToolsTool.description).toContain(group);
      }
    });
  });

  describe("runEnableTools", () => {
    it("enables valid groups and lists activated tools", async () => {
      const result = await runEnableTools({ groups: ["web", "code"] });
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("web_search");
      expect(result.content).toContain("code_exec");
    });

    it("returns error for empty groups array", async () => {
      const result = await runEnableTools({ groups: [] });
      expect(result.is_error).toBe(true);
    });

    it("returns error for unknown group", async () => {
      const result = await runEnableTools({ groups: ["bad"] });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("Unknown group or tool");
    });

    it("resolves tool names to parent groups", async () => {
      const result = await runEnableTools({ groups: ["web_search", "code_exec"] });
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("web_search");
      expect(result.content).toContain("code_exec");
      expect(getEnabledGroups()).toContain("web");
      expect(getEnabledGroups()).toContain("code");
    });

    it("handles mix of valid and invalid groups", async () => {
      const result = await runEnableTools({ groups: ["web", "bad"] });
      expect(result.is_error).toBe(true);
    });
  });

  describe("detectToolGroups", () => {
    it("detects web group from research keywords", () => {
      expect(detectToolGroups("Research the top JS frameworks")).toContain("web");
      expect(detectToolGroups("Look up current pricing")).toContain("web");
      expect(detectToolGroups("Browse the internet for examples")).toContain("web");
    });

    it("detects code group from computation keywords", () => {
      expect(detectToolGroups("Calculate the standard deviation")).toContain("code");
      expect(detectToolGroups("Plot a histogram of the data")).toContain("code");
      expect(detectToolGroups("Analyze this CSV file")).toContain("code");
      expect(detectToolGroups("Use python to process the data")).toContain("code");
    });

    it("detects multiple groups from a single prompt", () => {
      const groups = detectToolGroups("Research bundler benchmarks and plot a comparison chart");
      expect(groups).toContain("web");
      expect(groups).toContain("code");
    });

    it("detects management group from planning keywords", () => {
      expect(detectToolGroups("Create a plan for the migration")).toContain("management");
      expect(detectToolGroups("Break this into tasks")).toContain("management");
      expect(detectToolGroups("Track progress on the sprint")).toContain("management");
      expect(detectToolGroups("Remember this for later")).toContain("management");
      expect(detectToolGroups("Start a background server")).toContain("management");
      expect(detectToolGroups("Set a deadline for the feature")).toContain("management");
    });

    it("detects advanced_editing group from refactoring keywords", () => {
      expect(detectToolGroups("Refactor the auth module")).toContain("advanced_editing");
      expect(detectToolGroups("Rename the function across files")).toContain("advanced_editing");
      expect(detectToolGroups("Give me an overview of the codebase")).toContain("advanced_editing");
      expect(detectToolGroups("Bulk update all config files")).toContain("advanced_editing");
    });

    it("detects gui group from visual/screen keywords", () => {
      expect(detectToolGroups("Take a screenshot of the app")).toContain("gui");
      expect(detectToolGroups("Click on the submit button")).toContain("gui");
      expect(detectToolGroups("Show me what's on the screen")).toContain("gui");
      expect(detectToolGroups("Copy the result to clipboard")).toContain("gui");
      expect(detectToolGroups("Look at the desktop")).toContain("gui");
      expect(detectToolGroups("Open the browser and navigate")).toContain("gui");
      expect(detectToolGroups("View the image on screen")).toContain("gui");
    });

    it("detects orchestration group from parallel/chain keywords", () => {
      expect(detectToolGroups("Process all files in parallel")).toContain("orchestration");
      expect(detectToolGroups("Map over each entry in the list")).toContain("orchestration");
      expect(detectToolGroups("Apply the transform to each file in the directory")).toContain("orchestration");
      expect(detectToolGroups("Chain these steps together")).toContain("orchestration");
      expect(detectToolGroups("Fan out the search concurrently")).toContain("orchestration");
      expect(detectToolGroups("Run this for each item in the dataset")).toContain("orchestration");
    });

    it("does not detect gui for non-visual prompts", () => {
      expect(detectToolGroups("Fix the CSS styles")).not.toContain("gui");
      expect(detectToolGroups("Write a test for the login page")).not.toContain("gui");
    });

    it("does not detect orchestration for simple sequential requests", () => {
      expect(detectToolGroups("Read the file and fix the bug")).not.toContain("orchestration");
      expect(detectToolGroups("First check the logs then fix it")).not.toContain("orchestration");
    });

    it("detects management + code for data planning prompts", () => {
      const groups = detectToolGroups("Plan a data analysis pipeline and compute statistics");
      expect(groups).toContain("management");
      expect(groups).toContain("code");
    });

    it("returns empty for prompts with no signals", () => {
      expect(detectToolGroups("Fix the bug in auth.ts")).toEqual([]);
      expect(detectToolGroups("Read the README file")).toEqual([]);
      expect(detectToolGroups("Hello, how are you?")).toEqual([]);
    });

    it("is case insensitive", () => {
      expect(detectToolGroups("RESEARCH best practices")).toContain("web");
      expect(detectToolGroups("CALCULATE the sum")).toContain("code");
      expect(detectToolGroups("PLANNING the roadmap")).toContain("management");
      expect(detectToolGroups("REFACTORING the module")).toContain("advanced_editing");
    });

    it("does not match partial words incorrectly", () => {
      // "search" alone doesn't trigger web (could be file search)
      expect(detectToolGroups("Search for the function in the codebase")).not.toContain("web");
    });

    it("matches word stems like analyze, visualize, statistics, visualization", () => {
      // These failed before the trailing \b fix — stems didn't match inflected forms
      expect(detectToolGroups("Analyze the sales data")).toContain("code");
      expect(detectToolGroups("Visualize the results")).toContain("code");
      expect(detectToolGroups("Run some statistical analysis")).toContain("code");
      expect(detectToolGroups("Create a visualization")).toContain("code");
      expect(detectToolGroups("Show me statistics for Q1")).toContain("code");
    });

    it("detects web group from comparison and report prompts", () => {
      expect(detectToolGroups("Compare options for hosting")).toContain("web");
      expect(detectToolGroups("List pros and cons of React vs Vue")).toContain("web");
      expect(detectToolGroups("Write a report on current trends")).toContain("web");
      expect(detectToolGroups("Review alternatives for our CI provider")).toContain("web");
      expect(detectToolGroups("Do a competitive analysis of project management tools")).toContain("web");
      expect(detectToolGroups("Benchmark the top cloud providers")).toContain("web");
    });

    it("detects management group from organizational keywords", () => {
      expect(detectToolGroups("Organize the migration steps")).toContain("management");
      expect(detectToolGroups("Prioritize these features")).toContain("management");
      expect(detectToolGroups("Create a checklist for launch")).toContain("management");
      expect(detectToolGroups("Build a roadmap for Q2")).toContain("management");
      expect(detectToolGroups("Give me a breakdown of the work")).toContain("management");
      expect(detectToolGroups("Create a to-do list for the release")).toContain("management");
      expect(detectToolGroups("Extract action items from these notes")).toContain("management");
    });

    it("detects web + management for research-and-plan prompts", () => {
      const groups = detectToolGroups("Research hosting options and create a checklist for migration");
      expect(groups).toContain("web");
      expect(groups).toContain("management");
    });

    it("full pipeline: detectToolGroups → enableGroup → filterTools", () => {
      // Non-code scenario: "Compare database options and organize into a decision doc"
      const prompt = "Compare database options and prioritize them by cost";
      const detected = detectToolGroups(prompt);
      expect(detected).toContain("web");
      expect(detected).toContain("management");

      for (const g of detected) enableGroup(g);

      const active = getActiveToolNames();
      expect(active.has("web_search")).toBe(true);
      expect(active.has("web_fetch")).toBe(true);
      expect(active.has("http_request")).toBe(true);
      expect(active.has("todo")).toBe(true);
      // memory is now registered via module loader, not hardcoded in TOOL_GROUPS
      // code_exec should NOT be enabled (web + management detected, not code)
      expect(active.has("code_exec")).toBe(false);
      // batch/pipe/map are in orchestration group, not enabled by web+management
      expect(active.has("batch")).toBe(false);
    });

    it("detects web for general-purpose recommendation and discovery queries", () => {
      expect(detectToolGroups("What is the best camera for beginners?")).toContain("web");
      expect(detectToolGroups("Recommend a good restaurant in Austin")).toContain("web");
      expect(detectToolGroups("Find a hotel near the conference center")).toContain("web");
      expect(detectToolGroups("How much does a flight to Tokyo cost?")).toContain("web");
      expect(detectToolGroups("Check the current weather in Portland")).toContain("web");
      expect(detectToolGroups("Look into alternatives for Slack")).toContain("web");
    });

    it("detects code for data tasks beyond pure programming", () => {
      expect(detectToolGroups("Create a budget spreadsheet for Q2")).toContain("code");
      expect(detectToolGroups("Forecast revenue for next quarter")).toContain("code");
      expect(detectToolGroups("Convert units from imperial to metric")).toContain("code");
      expect(detectToolGroups("Build a histogram of response times")).toContain("code");
      expect(detectToolGroups("Find the correlation between price and sales")).toContain("code");
    });

    it("detects management for non-coding organizational tasks", () => {
      expect(detectToolGroups("Create an itinerary for my Portland trip")).toContain("management");
      expect(detectToolGroups("Draft an agenda for tomorrow's meeting")).toContain("management");
      expect(detectToolGroups("Build a timeline for the product launch")).toContain("management");
      expect(detectToolGroups("Brainstorm ideas for the team offsite")).toContain("management");
      expect(detectToolGroups("Summarize the meeting notes into action items")).toContain("management");
      expect(detectToolGroups("Plan the sprint retrospective")).toContain("management");
    });

    it("cross-domain: trip planning enables web + management + code", () => {
      const groups = detectToolGroups(
        "Plan a weekend trip to Portland. Research restaurants, create an itinerary, and estimate the budget"
      );
      expect(groups).toContain("web");
      expect(groups).toContain("management");
      expect(groups).toContain("code"); // "budget" → "estimate" triggers via "forecast" won't but budget doesn't... let's check
    });
  });
});
