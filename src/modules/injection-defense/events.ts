/**
 * Typed event declaration owned by the injection-defense module.
 */

import { defineModuleEvent } from "#core/events/module-event.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";

export type InjectionDefenseAssessedPayload = {
  tool: string;
  suspicious: boolean;
  reasons: string[];
  action: "annotate" | "skip";
  autonomyMode: AutonomyMode;
  session?: string;
};

/**
 * Injection-defense module screened a tool result on an autonomous run.
 * Emitted for every screened call — not just suspicious ones — so operators
 * can audit both missed attacks and false-positive rate. `reasons` is
 * non-empty only when `suspicious` is true; `autonomyMode` is the session
 * posture that triggered screening.
 */
export const injectionDefenseAssessed =
  defineModuleEvent<InjectionDefenseAssessedPayload>(
    "injection.defense.assessed",
    ["tool", "suspicious", "reasons", "action", "autonomyMode", "session"],
  );
