import { buildUserProfile, type KotaConfig } from "../config.js";
import { loadInstructionContext } from "../instruction-files.js";
import { loadProjectContext } from "../project-context.js";
import type { SDKSystemPrompt } from "./types.js";

export function buildClaudeCodeSystemPrompt(
  config?: KotaConfig,
  extraInstructions?: string,
): SDKSystemPrompt {
  const sections = [
    loadProjectContext(),
    loadInstructionContext(),
    config ? buildUserProfile(config) : "",
    extraInstructions?.trim()
      ? `\n\n## Autonomous Agent Instructions\n\n${extraInstructions.trim()}`
      : "",
  ].filter(Boolean);

  if (sections.length === 0) {
    return { type: "preset", preset: "claude_code" };
  }

  return {
    type: "preset",
    preset: "claude_code",
    append: sections.join(""),
  };
}
