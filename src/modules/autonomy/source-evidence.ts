import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import type { TaskReviewTarget } from "./task-review-target.js";
import { findTaskReviewTarget } from "./task-review-target.js";

export const SOURCE_EVIDENCE_FILE = "source-evidence.json";

export type SourceEvidenceStatus = "read" | "blocked";

export type SourceEvidenceEntry = {
  url: string;
  status: SourceEvidenceStatus;
  method: string;
  evidence: string;
};

export type SourceEvidenceFile = {
  sources: SourceEvidenceEntry[];
};

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCTUATION_RE = /[),.;!?]+$/;

export function requiredSourceUrls(taskContent: string): string[] {
  const urls = extractUrls(taskContent);
  if (urls.length === 0) return [];

  const { attrs, body } = parseFlatFrontMatter(taskContent);
  const area = attrs.area;
  const areaIsResearch = typeof area === "string" && /^(research|resource)$/i.test(area);
  const hasResourcesSection = /^##\s+Resources\b/im.test(body);
  const hasSourceLine = /^\s*(?:[-*]\s*)?(?:url|source|resource)s?\s*:/im.test(body);
  const title = typeof attrs.title === "string" ? attrs.title : "";
  const summary = typeof attrs.summary === "string" ? attrs.summary : "";
  const researchIntent = /\b(research|review|investigate|understand)\b/i.test(`${title} ${summary}`);

  return areaIsResearch || hasResourcesSection || hasSourceLine || researchIntent ? urls : [];
}

export function validateTaskSourceEvidence(
  target: TaskReviewTarget | null,
  runDirPath: string,
): string {
  if (!target) return "OK: no task requiring source evidence";

  const urls = requiredSourceUrls(target.content);
  if (urls.length === 0) return "OK: task does not require source evidence";

  const evidence = readSourceEvidence(runDirPath);
  const byUrl = new Map(evidence.sources.map((source) => [source.url, source]));
  const missing = urls.filter((url) => !byUrl.has(url));
  if (missing.length > 0) {
    throw new Error(
      `Missing ${SOURCE_EVIDENCE_FILE} entries for required source URL(s): ${missing.join(", ")}`,
    );
  }

  const weak = urls
    .map((url) => byUrl.get(url)!)
    .filter((source) => source.method.trim().length < 3 || source.evidence.trim().length < 20)
    .map((source) => source.url);
  if (weak.length > 0) {
    throw new Error(
      `${SOURCE_EVIDENCE_FILE} has weak evidence for required source URL(s): ${weak.join(", ")}`,
    );
  }

  const blocked = urls.filter((url) => byUrl.get(url)!.status === "blocked");
  if (target.state === "done" && blocked.length > 0) {
    throw new Error(
      `Task ${target.path} is marked done but required source URL(s) are blocked: ${blocked.join(", ")}`,
    );
  }
  if (target.state === "doing") {
    throw new Error(
      `Source-backed task ${target.path} is still in doing/. Move it to done only after all sources are read, or to blocked when a required source cannot be processed.`,
    );
  }

  return `OK: source evidence covers ${urls.length} required URL(s) for ${target.state} task`;
}

export function checkSourceEvidence(projectDir: string, runDirPath: string): string {
  return validateTaskSourceEvidence(findTaskReviewTarget(projectDir), runDirPath);
}

export function readSourceEvidence(runDirPath: string): SourceEvidenceFile {
  const path = join(runDirPath, SOURCE_EVIDENCE_FILE);
  if (!existsSync(path)) {
    throw new Error(
      `Missing ${SOURCE_EVIDENCE_FILE} in the run directory. Source-backed tasks must record one entry per required URL.`,
    );
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return assertSourceEvidenceFile(parsed);
}

export function formatSourceEvidenceForReview(runDirPath: string): string {
  const path = join(runDirPath, SOURCE_EVIDENCE_FILE);
  if (!existsSync(path)) return `No ${SOURCE_EVIDENCE_FILE} found.`;
  return readFileSync(path, "utf8").trim();
}

function extractUrls(text: string): string[] {
  const found = text.match(URL_RE) ?? [];
  return [...new Set(found.map((url) => url.replace(TRAILING_PUNCTUATION_RE, "")))];
}

function assertSourceEvidenceFile(value: unknown): SourceEvidenceFile {
  if (!value || typeof value !== "object" || !Array.isArray((value as SourceEvidenceFile).sources)) {
    throw new Error(`${SOURCE_EVIDENCE_FILE} must be an object with a sources array`);
  }

  return {
    sources: (value as SourceEvidenceFile).sources.map(assertSourceEvidenceEntry),
  };
}

function assertSourceEvidenceEntry(value: unknown): SourceEvidenceEntry {
  if (!value || typeof value !== "object") {
    throw new Error(`${SOURCE_EVIDENCE_FILE} source entries must be objects`);
  }

  const entry = value as SourceEvidenceEntry;
  if (typeof entry.url !== "string" || entry.url.length === 0) {
    throw new Error(`${SOURCE_EVIDENCE_FILE} source entries require url`);
  }
  if (entry.status !== "read" && entry.status !== "blocked") {
    throw new Error(`${SOURCE_EVIDENCE_FILE} source entries require status "read" or "blocked"`);
  }
  if (typeof entry.method !== "string" || entry.method.length === 0) {
    throw new Error(`${SOURCE_EVIDENCE_FILE} source entries require method`);
  }
  if (typeof entry.evidence !== "string" || entry.evidence.length === 0) {
    throw new Error(`${SOURCE_EVIDENCE_FILE} source entries require evidence`);
  }
  return entry;
}
