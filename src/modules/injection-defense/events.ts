/**
 * Typed event declaration owned by the injection-defense module.
 */

import { defineDaemonWideModuleEvent } from "#core/events/module-event.js";
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
 *
 * Daemon-wide: tool-call screening fires from inside the agent tool loop,
 * which is session-bound and not yet projectId-attributed. This declaration
 * tracks the same boundary as `BusEvents["guardrail.assessed"]`; both
 * migrate to project scope once session-projectId attribution lands.
 */
export const injectionDefenseAssessed =
  defineDaemonWideModuleEvent<InjectionDefenseAssessedPayload>(
    "injection.defense.assessed",
    ["tool", "suspicious", "reasons", "action", "autonomyMode", "session"],
    {
      payloadSchema: {
        type: "object",
        properties: {
          tool: { type: "string" },
          suspicious: { type: "boolean" },
          reasons: { type: "array", items: { type: "string" } },
          action: { type: "string", enum: ["annotate", "skip"] },
          autonomyMode: {
            type: "string",
            enum: ["passive", "supervised", "autonomous"],
          },
          session: { type: "string", required: false },
        },
      },
      sensitivity: "internal",
    },
  );
