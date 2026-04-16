import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeEntry } from "#core/memory/knowledge-store.js";
import { KnowledgeStore } from "#core/memory/knowledge-store.js";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";

export type KnowledgeRecallResult = {
  query: string;
  entries: Array<{ id: string; title: string; type: string; tags: string[]; summary: string }>;
};

const MAX_ENTRIES = 5;
const MAX_SUMMARY_LENGTH = 300;

function summarizeEntry(entry: KnowledgeEntry): string {
  const content = entry.content.trim();
  if (content.length <= MAX_SUMMARY_LENGTH) return content;
  return `${content.slice(0, MAX_SUMMARY_LENGTH)}…`;
}

function formatResult(query: string, entries: KnowledgeEntry[]): KnowledgeRecallResult {
  return {
    query,
    entries: entries.slice(0, MAX_ENTRIES).map((e) => ({
      id: e.id,
      title: e.title,
      type: e.type,
      tags: e.tags,
      summary: summarizeEntry(e),
    })),
  };
}

function buildBuilderSearchQuery(projectDir: string): string {
  const terms: string[] = [];
  for (const state of ["doing", "ready"] as const) {
    const dir = join(projectDir, "data", "tasks", state);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "AGENTS.md");
    for (const file of files) {
      const raw = readFileSync(join(dir, file), "utf-8");
      const { attrs } = parseFlatFrontMatter(raw);
      const title = attrs.title;
      const area = attrs.area;
      const summary = attrs.summary;
      if (typeof title === "string") terms.push(title);
      if (typeof area === "string") terms.push(area);
      if (typeof summary === "string") terms.push(summary);
    }
  }
  return terms.join(" ");
}

export function recallForBuilder(projectDir: string): KnowledgeRecallResult {
  const query = buildBuilderSearchQuery(projectDir);
  if (!query) return { query: "", entries: [] };
  const store = new KnowledgeStore(projectDir);
  const entries = store.search(query);
  return formatResult(query, entries);
}

export function recallForImprover(projectDir: string): KnowledgeRecallResult {
  const query = "workflow autonomous builder improver failure repair cost quality";
  const store = new KnowledgeStore(projectDir);
  const entries = store.search(query);
  return formatResult(query, entries);
}

export function recallForExplorer(projectDir: string): KnowledgeRecallResult {
  const query = "exploration task discovery architecture module capability gap";
  const store = new KnowledgeStore(projectDir);
  const entries = store.search(query);
  return formatResult(query, entries);
}

export function recallForDecomposer(projectDir: string): KnowledgeRecallResult {
  const query = "decompose timeout builder failure split task scope";
  const store = new KnowledgeStore(projectDir);
  const entries = store.search(query);
  return formatResult(query, entries);
}
