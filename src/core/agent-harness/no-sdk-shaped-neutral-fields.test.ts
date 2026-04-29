/**
 * Guard test: provider-shaped fields must not creep onto the neutral
 * `AgentHarnessRunOptions` surface.
 *
 * The `task-neutralize-agent-harness-wire-protocol` cleanup moved every
 * claude-agent-sdk-shaped knob (permission modes, setting sources, snake-case
 * session ids, raw provider message frames as a permissive arm of the
 * AgentMessage union) off the core protocol and into adapter-private
 * fragments. A regression that re-introduces any of those fields turns this
 * test red.
 *
 * The check is deliberately textual against `src/core/agent-harness/types.ts`
 * and `src/core/agent-harness/agent-message.ts` rather than reflective: the
 * intent is to catch a future contributor who adds a field whose name is the
 * same string the SDK uses, even if its body is technically valid TypeScript.
 * Adding a field whose name matches one of the banned identifiers is the
 * regression we want to flag — rename it to a KOTA-native identifier or push
 * it through the adapter-private `harnessOverrides` channel instead.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TYPES_PATH = join(import.meta.dirname, "types.ts");
const AGENT_MESSAGE_PATH = join(import.meta.dirname, "agent-message.ts");

/**
 * Identifiers that name claude-agent-sdk wire fields. Each one used to live
 * on the neutral protocol and now lives behind an adapter seam.
 */
const BANNED_NEUTRAL_FIELD_NAMES = [
  "permissionMode",
  "settingSources",
  "session_id",
  "decisionClassification",
  "user_temporary",
  "user_permanent",
  "user_reject",
] as const;

describe("neutral agent-harness types are free of claude-sdk-shaped fields", () => {
  const sources: Array<{ name: string; body: string }> = [
    { name: "types.ts", body: readFileSync(TYPES_PATH, "utf-8") },
    { name: "agent-message.ts", body: readFileSync(AGENT_MESSAGE_PATH, "utf-8") },
  ];

  for (const banned of BANNED_NEUTRAL_FIELD_NAMES) {
    it(`does not declare or reference "${banned}" as a neutral field`, () => {
      // Use word-boundary regex so a comment like "claude-sdk's
      // permissionMode" is caught the same way as a field declaration —
      // accidental documentation of the banned shape on the neutral surface
      // is itself a smell, and the cleanup PR should not have left any.
      const pattern = new RegExp(`\\b${banned}\\b`);
      for (const { name, body } of sources) {
        expect(
          pattern.test(body),
          `Banned identifier "${banned}" appears in src/core/agent-harness/${name}. ` +
            "Move provider-specific knobs into the adapter via " +
            "AgentHarness.validateStepOptions and the AgentHarnessStepOverrides " +
            "fragment, or rename the concept to a KOTA-native identifier.",
        ).toBe(false);
      }
    });
  }

  it("AgentHarnessRunOptions exposes the KOTA-native autonomyMode field", () => {
    const body = readFileSync(TYPES_PATH, "utf-8");
    expect(body).toMatch(/autonomyMode\?:\s*AutonomyMode/);
  });

  it("AgentHarnessRunOptions exposes the adapter-private harnessOverrides slot", () => {
    const body = readFileSync(TYPES_PATH, "utf-8");
    expect(body).toMatch(/harnessOverrides\?:\s*AgentHarnessStepOverrides/);
  });
});
