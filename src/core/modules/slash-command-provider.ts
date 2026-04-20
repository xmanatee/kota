/**
 * Core contract for the slash-command catalog provider.
 *
 * The implementation lives in the `commands` module. Core only holds the
 * contract so the daemon control server can look up the catalog through the
 * provider registry without importing module code.
 */

export type SlashCommandSource = "workflow" | "skill";

export type SlashCommand = {
  /** Canonical command name used by invoke (e.g. `"builder"`, `"skill:deep-research"`). */
  name: string;
  /** Display label as it appears in the palette (e.g. `"/builder"`). */
  label: string;
  description?: string;
  source: SlashCommandSource;
  /** Name of the module that contributes the backing primitive. */
  module: string;
};

export type SlashCommandAction =
  | { kind: "workflow"; workflow: string }
  | { kind: "skill"; prompt: string };

export type SlashCommandCatalog = {
  list(): SlashCommand[];
  resolve(name: string): SlashCommandAction | null;
};

/** Provider-registry key used to look up the active slash-command catalog. */
export const SLASH_COMMAND_PROVIDER_TYPE = "slash-command-catalog";
