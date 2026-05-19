import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "#core/agents/system-prompt.js";
import { formatResolvedToolGuidance } from "#core/agents/tool-guidance.js";
import { buildAnswerDynamicStateProvider } from "#modules/answer/system-prompt.js";
import { buildCaptureDynamicStateProvider } from "#modules/capture/system-prompt.js";
import { batchTool } from "#modules/composition/batch.js";
import { mapTool } from "#modules/composition/map.js";
import { pipeTool } from "#modules/composition/pipe.js";
import { codeExecTool } from "#modules/execution/code-exec.js";
import { computerUseTool } from "#modules/execution/computer-use.js";
import { processTool } from "#modules/execution/process.js";
import { screenshotTool } from "#modules/execution/screenshot.js";
import { grepTool } from "#modules/filesystem/grep.js";
import { knowledgeTool } from "#modules/knowledge/knowledge-schema.js";
import { memoryTool } from "#modules/memory/memory.js";
import { notebookTool } from "#modules/notebook/notebook.js";
import { buildRecallDynamicStateProvider } from "#modules/recall/system-prompt.js";
import { buildRetractDynamicStateProvider } from "#modules/retract/system-prompt.js";
import { sqliteTool } from "#modules/system/sqlite.js";
import { httpRequestTool } from "#modules/web-access/http-request.js";
import { webFetchTool } from "#modules/web-access/web-fetch.js";
import { webSearchTool } from "#modules/web-access/web-search.js";

const MODULE_TOOL_NAMES = [
  "file_read",
  "file_write",
  "file_edit",
  "multi_edit",
  "find_replace",
  "grep",
  "glob",
  "files_overview",
  "repo_map",
  "web_fetch",
  "web_search",
  "http_request",
  "code_exec",
  "computer_use",
];

describe("SYSTEM_PROMPT", () => {
  it("keeps the base prompt to durable core rails", () => {
    for (const section of [
      "## Approach",
      "## Tool Use",
      "## Delegation",
      "## Quality",
      "## Error Recovery",
      "## Safety",
    ]) {
      expect(SYSTEM_PROMPT).toContain(section);
    }

    expect(SYSTEM_PROMPT).toMatch(/^You are KOTA/);
    expect(SYSTEM_PROMPT).toContain("personal assistant");
    expect(SYSTEM_PROMPT).toContain("whatever the user needs");
  });

  it("does not reintroduce a module-owned tool catalog in the base prompt", () => {
    for (const name of MODULE_TOOL_NAMES) {
      expect(SYSTEM_PROMPT).not.toContain(name);
    }

    expect(SYSTEM_PROMPT).not.toContain("Workflow Patterns");
    expect(SYSTEM_PROMPT).not.toContain("Data handoff via files");
    expect(SYSTEM_PROMPT).not.toContain("pip install <pkg>");
    expect(SYSTEM_PROMPT).not.toContain("pnpm add <pkg>");
  });

  it("stays concise enough to leave room for loaded-module guidance", () => {
    expect(SYSTEM_PROMPT.length).toBeLessThan(4500);
  });
});

describe("resolved tool guidance", () => {
  it("is generated from loaded tool metadata for common capability modules", () => {
    const guidance = formatResolvedToolGuidance([
      grepTool,
      webSearchTool,
      webFetchTool,
      httpRequestTool,
      codeExecTool,
      processTool,
      computerUseTool,
      screenshotTool,
      memoryTool,
      knowledgeTool,
      notebookTool,
      sqliteTool,
      batchTool,
      pipeTool,
      mapTool,
    ]);

    for (const name of [
      "grep",
      "web_search",
      "web_fetch",
      "http_request",
      "code_exec",
      "process",
      "computer_use",
      "screenshot",
      "memory",
      "knowledge",
      "notebook",
      "sqlite",
      "batch",
      "pipe",
      "map",
    ]) {
      expect(guidance).toContain(`- ${name}:`);
    }

    expect(guidance).toContain("files_only");
    expect(guidance).toContain("save_to");
    expect(guidance).toContain("language");
    expect(guidance).toContain("coordinate_space");
    expect(guidance).toContain("semantic");
  });

  it("omits capability guidance for tools that are not resolved", () => {
    const guidance = formatResolvedToolGuidance([memoryTool]);

    expect(guidance).toContain("- memory:");
    expect(guidance).not.toContain("web_fetch");
    expect(guidance).not.toContain("http_request");
    expect(guidance).not.toContain("code_exec");
    expect(guidance).not.toContain("notebook");
    expect(guidance).not.toContain("sqlite");
  });

  it("composes with existing conversational dynamic-state contributors", () => {
    const activeTools = new Set(["capture", "recall", "answer", "retract"]);
    const dynamicState = [
      formatResolvedToolGuidance([memoryTool]),
      buildCaptureDynamicStateProvider()({ activeTools }),
      buildRecallDynamicStateProvider()({ activeTools }),
      buildAnswerDynamicStateProvider()({ activeTools }),
      buildRetractDynamicStateProvider()({ activeTools }),
    ].join("");

    expect(dynamicState).toContain("<available-tools>");
    expect(dynamicState).toContain("<capture-tool>");
    expect(dynamicState).toContain("<recall-tool>");
    expect(dynamicState).toContain("<answer-tool>");
    expect(dynamicState).toContain("<retract-tool>");
  });
});
