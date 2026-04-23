import { buildUserProfile, type KotaConfig } from "#core/config/config.js";
import { loadInstructionContext } from "./instruction-files.js";
import { loadProjectContext } from "./project-context.js";

/**
 * Compose the portable KOTA system-prompt text a harness-neutral caller
 * delivers to an agent run. Returns a plain string (or `undefined` when no
 * section has content) so every adapter can pass it straight to its native
 * system-prompt field; adapters that want to wrap the text in a native
 * envelope (e.g. the claude-agent-sdk `claude_code` preset) do so at their
 * own boundary.
 */
export function buildKotaSystemPrompt(
  config?: KotaConfig,
  extraInstructions?: string,
  startDir?: string,
  rootDir?: string,
  skillsPrompt?: string,
): string | undefined {
  const sections = [
    loadProjectContext(startDir, rootDir),
    loadInstructionContext(startDir, rootDir),
    config ? buildUserProfile(config) : "",
    skillsPrompt ?? "",
    extraInstructions?.trim()
      ? `\n\n## Autonomous Agent Instructions\n\n${extraInstructions.trim()}`
      : "",
  ].filter(Boolean);

  if (sections.length === 0) return undefined;
  return sections.join("");
}
