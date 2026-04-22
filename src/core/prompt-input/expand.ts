import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/**
 * Maximum byte length inlined per referenced file. Matches the per-file cap
 * used for instruction files so a user prompt cannot silently balloon by
 * referencing a huge artifact.
 */
export const MAX_REF_BYTES = 16_000;

const TRUNCATION_MARKER = "\n... (truncated)";

/**
 * Reference pattern for user prompts.
 *
 * Matches `@path` where `path` is a whitespace-free sequence starting with a
 * letter, digit, `.`, `/`, `_`, or `-`. A leading `(?:^|(?<=\s))` ensures the
 * `@` is either at the start of input or preceded by whitespace, so email
 * addresses and decorators like `@see` inside prose are not accidentally
 * treated as references.
 */
const REF_PATTERN = /(?:^|(?<=\s))@([A-Za-z0-9_./~-][^\s]*)/g;

export type PromptReferenceOutcome =
  | { kind: "file"; path: string; display: string; inlined: string; truncated: boolean }
  | { kind: "missing"; path: string; display: string }
  | { kind: "directory"; path: string; display: string }
  | { kind: "error"; path: string; display: string; reason: string };

export type ExpandUserPromptReferencesResult = {
  text: string;
  references: PromptReferenceOutcome[];
};

/**
 * Expand `@path` references in a user prompt against the given base directory.
 *
 * - Each reference to a regular file is inlined as a
 *   `<file path="…">…</file>` block appended after the prompt, with the
 *   original `@path` token left in place so the surrounding prose still reads
 *   naturally.
 * - Directories and missing paths are left as plain text — the agent sees the
 *   reference but no file contents are attached.
 * - Per-file byte cap (`MAX_REF_BYTES`) matches the instruction-file cap so
 *   one referenced artifact cannot silently crowd out the rest of the turn.
 *
 * The function is harness-neutral: every CLI path should call it before
 * handing the prompt off to any `AgentHarness`, so claude-agent-sdk, thin,
 * and any future adapter see the same expanded text.
 */
export function expandUserPromptReferences(
  prompt: string,
  baseDir: string,
): ExpandUserPromptReferencesResult {
  const seen = new Map<string, PromptReferenceOutcome>();
  const order: PromptReferenceOutcome[] = [];

  for (const match of prompt.matchAll(REF_PATTERN)) {
    const raw = match[1];
    if (!raw) continue;
    const cleaned = stripTrailingPunctuation(raw);
    if (!cleaned) continue;
    const resolvedPath = isAbsolute(cleaned) ? cleaned : resolve(baseDir, cleaned);
    if (seen.has(resolvedPath)) continue;

    const outcome = classifyReference(resolvedPath, cleaned);
    seen.set(resolvedPath, outcome);
    order.push(outcome);
  }

  if (order.length === 0) return { text: prompt, references: [] };

  const blocks: string[] = [];
  for (const ref of order) {
    if (ref.kind !== "file") continue;
    blocks.push(
      `<file path="${ref.display}">\n${ref.inlined}${ref.truncated ? TRUNCATION_MARKER : ""}\n</file>`,
    );
  }

  if (blocks.length === 0) return { text: prompt, references: order };

  const header = "\n\n## Referenced files\n\n";
  return {
    text: `${prompt}${header}${blocks.join("\n\n")}`,
    references: order,
  };
}

function stripTrailingPunctuation(raw: string): string {
  return raw.replace(/[),.;:!?]+$/, "");
}

function classifyReference(
  resolvedPath: string,
  display: string,
): PromptReferenceOutcome {
  if (!existsSync(resolvedPath)) {
    return { kind: "missing", path: resolvedPath, display };
  }
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(resolvedPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { kind: "error", path: resolvedPath, display, reason };
  }
  if (stats.isDirectory()) {
    return { kind: "directory", path: resolvedPath, display };
  }
  if (!stats.isFile()) {
    return { kind: "error", path: resolvedPath, display, reason: "not a regular file" };
  }
  try {
    const raw = readFileSync(resolvedPath, "utf-8");
    const truncated = raw.length > MAX_REF_BYTES;
    const inlined = truncated ? raw.slice(0, MAX_REF_BYTES) : raw;
    return { kind: "file", path: resolvedPath, display, inlined, truncated };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { kind: "error", path: resolvedPath, display, reason };
  }
}
