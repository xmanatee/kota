import { parseFlatFrontMatter, splitFrontMatter } from "#core/util/frontmatter.js";

export const UNSUPPORTED_SKILL_TOOL_POLICY_KEYS = [
  "allowed-tools",
  "disallowed-tools",
  "tools",
] as const;

export type UnsupportedSkillToolPolicyKey =
  (typeof UNSUPPORTED_SKILL_TOOL_POLICY_KEYS)[number];

export function findUnsupportedSkillToolPolicyKeys(
  keys: Iterable<string>,
): UnsupportedSkillToolPolicyKey[] {
  const present = new Set(keys);
  return UNSUPPORTED_SKILL_TOOL_POLICY_KEYS.filter((key) => present.has(key));
}

export function unsupportedSkillToolPolicyDiagnostic(
  source: string,
  keys: readonly UnsupportedSkillToolPolicyKey[],
): string {
  const quoted = keys.map((key) => `"${key}"`).join(", ");
  return (
    `${source}: unsupported skill tool-policy frontmatter ${quoted}; ` +
    "KOTA does not enforce skill-declared tool policy. Declare tool access through AgentDef.tools or the session tool policy."
  );
}

export function assertNoUnsupportedSkillToolPolicyFrontmatter(
  raw: string,
  source: string,
): void {
  if (!splitFrontMatter(raw)) return;
  const { attrs } = parseFlatFrontMatter(raw);
  const keys = findUnsupportedSkillToolPolicyKeys(Object.keys(attrs));
  if (keys.length > 0) {
    throw new Error(unsupportedSkillToolPolicyDiagnostic(source, keys));
  }
}
