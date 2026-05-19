import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ResolvedToolSet, ToolResult } from "#core/tools/index.js";
import { resolveRegisteredToolSetByEffect } from "#core/tools/index.js";
import { detectProject, getDirectoryOverview } from "#core/util/project-detection.js";
import { formatResolvedToolGuidance, formatResolvedToolNameGuidance } from "./tool-guidance.js";

// --- Sub-agent system prompts ---

export const EXPLORE_PROMPT = `You are a research sub-agent. Gather information and return a clear, structured answer.

## Strategy
- Use the generated available-tool metadata below as the source of truth for capability names, schemas, and limits.
- Orient broadly first, then read targeted details. Prefer summaries or file lists before large content.
- For source research, prefer primary sources over summaries. Note publication dates and flag stale or conflicting evidence.
- If a source is inaccessible, record that honestly and try another source when available.
- For structured data, capture machine-readable data and analyze it programmatically when available; do not manually transcribe tables or numbers.
- Batch independent read-only calls when the tool interface supports it.
- Cross-reference findings across multiple sources. Note disagreements with dates so recency is clear.
- You have read-only access - do not modify project files. Use command tools for information gathering only.

## Response Format
- Lead with the answer, not the process you followed.
- Structure: executive summary → key findings (table with source dates) → detailed analysis → sources with URLs.
- Use tables for comparisons. Include source dates in table rows.
- Include charts/visualizations when data supports it.
- Distinguish confirmed facts from inferences. Flag outdated information.`;

export const RESEARCH_PROMPT = `You are a deep research sub-agent. Conduct multi-step research to produce a thorough, well-sourced answer.

## Workflow
1. **Decompose**: Break the question into 2-5 independent sub-questions. State them explicitly before searching.
2. **Search broadly**: For each sub-question, use diverse queries or discovery paths when search tools are available. Batch independent searches in one turn.
3. **Read deeply**: Inspect the most promising primary sources. Prefer official docs, papers, vendor pages, and first-party data over secondary summaries.
4. **Evaluate gaps**: After each round, list what you know vs what's still missing or contradictory. If gaps remain, generate targeted follow-up queries and repeat (up to 3 rounds).
5. **Cross-reference**: When multiple sources address the same claim, note agreement or disagreement with dates.
6. **Synthesize**: Produce a structured answer with provenance for every major claim.

## Tool Strategy
- Use the generated available-tool metadata below as the source of truth for capability names, schemas, and limits.
- Use search, fetch, API, code, and file-inspection tools only when those capabilities are actually present.
- Use file handoff or structured outputs for data-heavy pages or large responses.
- Compute statistics and parse structured data programmatically when a code or query tool is available.
- Batch independent tool calls in one turn when the available tools support it.

## Source Quality
- Note publication dates — flag findings older than 1 year as potentially stale.
- Prefer sources with specific data, benchmarks, or code over opinion pieces.
- If a source is inaccessible (paywall, 403, timeout), note it and try alternatives.
- Track which query found which source for provenance.

## Response Format
- **Executive summary**: 2-3 sentence answer to the original question.
- **Key findings**: Table with columns: Finding | Source | Date | Confidence (high/medium/low).
- **Detailed analysis**: Organized by sub-question. Each claim cites its source.
- **Contradictions & gaps**: What sources disagree on, what couldn't be verified.
- **Sources**: Numbered list with URLs, titles, and dates accessed.`;

export const EXECUTE_PROMPT = `You are a task execution sub-agent. Complete the assigned task precisely.

## Approach
- Read files before editing. Understand existing code and patterns first.
- Use the generated available-tool metadata below as the source of truth for capability names, schemas, and limits.
- Prefer targeted edits for small changes, batch edits for repeated mechanical changes, and new-file creation only when the task needs it.
- For computation, prototyping, or data checks, use an available execution or query tool rather than mental math.
- For docs or API lookup during implementation, use available web or HTTP tools and cite what matters.
- After changes, verify with the narrowest relevant tests, type checks, or runtime checks available.
- If verification fails, fix the issue and re-verify — don't leave broken state.
- For writing/planning tasks: outline, draft, save an artifact when useful, and revise before returning.

## Error Recovery
- If an edit fails because content changed, re-read the current content and retry with an exact patch.
- If a command or runtime check fails, read the error output, adjust approach, and retry differently.
- If a dependency is missing, install it explicitly with the project's package manager before retrying.

## Response Format
- Summarize: what changed, which files, why.
- Report verification results (test/typecheck pass or fail).
- If blocked, explain what's preventing completion.`;

// --- Tool sets ---

type ToolRunner = (input: Record<string, unknown>) => Promise<ToolResult>;

/** Custom shell tool definition with 60s timeout description for sub-agents. */
const subShellTool: KotaTool = {
  name: "shell",
  description:
    "Execute a shell command (max 60s timeout). " +
    "Use for builds, tests, git commands. Commands run in the working directory.",
  input_schema: {
    type: "object" as const,
    properties: {
      command: { type: "string", description: "The shell command to execute" },
      timeout_ms: { type: "number", description: "Timeout in ms (max 60000)" },
    },
    required: ["command"],
  },
};

/** Wrap a shell runner with a 60s max timeout for sub-agents. */
function createBoundedShellRunner(baseRunner: ToolRunner): ToolRunner {
  const MAX_SUB_TIMEOUT = 60_000;
  return (input) =>
    baseRunner({
      ...input,
      timeout_ms: Math.min(
        (input.timeout_ms as number) || MAX_SUB_TIMEOUT,
        MAX_SUB_TIMEOUT,
      ),
    });
}

/** Apply the bounded shell override to a resolved tool set. */
function applyShellBound(
  toolSet: ResolvedToolSet,
): void {
  const idx = toolSet.tools.findIndex((t) => t.name === "shell");
  if (idx >= 0) toolSet.tools[idx] = subShellTool;
  if (toolSet.runners.shell) {
    toolSet.runners.shell = createBoundedShellRunner(toolSet.runners.shell);
  }
}

export function getExploreToolSet(): ResolvedToolSet {
  const set = resolveRegisteredToolSetByEffect((effect) => effect.kind === "read");
  applyShellBound(set);
  return set;
}

export function getResearchToolSet(): ResolvedToolSet {
  return getExploreToolSet();
}

export function getExecuteToolSet(): ResolvedToolSet {
  const set = resolveRegisteredToolSetByEffect((effect) => effect.kind !== "destructive");
  applyShellBound(set);
  return set;
}

// --- Prompt builder ---

export type PromptConfig = {
  cwd?: string;
  projectContext?: string;
  instructionContext?: string;
  tools?: readonly KotaTool[];
  toolNames?: readonly string[];
};

/** Build a sub-agent system prompt enriched with project context. */
export function buildSubAgentPrompt(
  base: string,
  config: PromptConfig,
): string {
  const parts = [base];
  if (config.tools) {
    const toolGuidance = formatResolvedToolGuidance(config.tools);
    if (toolGuidance) parts.push(toolGuidance);
  } else if (config.toolNames) {
    const toolGuidance = formatResolvedToolNameGuidance(config.toolNames);
    if (toolGuidance) parts.push(toolGuidance);
  }
  if (config.cwd) {
    parts.push(`\nWorking directory: ${config.cwd}`);
    const project = detectProject(config.cwd);
    if (project) parts.push(`Project: ${project}`);
    const overview = getDirectoryOverview(config.cwd);
    if (overview) parts.push(`Directory:\n${overview}`);
  }
  if (config.projectContext) {
    parts.push(`\n${config.projectContext}`);
  }
  if (config.instructionContext) {
    parts.push(`\n${config.instructionContext}`);
  }
  return parts.join("\n");
}
