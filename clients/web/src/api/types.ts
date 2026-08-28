export type { ScopeRegistryProjection } from "../../../conformance/daemon-contract.generated";

export type AutonomyMode = "passive" | "supervised" | "autonomous";

export type InteractiveSession = {
  id: string;
  scopeId: string;
  createdAt: string;
  lastActive: number;
  autonomyMode: AutonomyMode;
  source?: "daemon" | "serve";
};

export type SlashCommand = {
  name: string;
  label: string;
  description?: string;
  source: "workflow" | "skill";
  module: string;
};

export type SlashCommandInvocation =
  | { kind: "workflow"; queued: string; runId?: string }
  | { kind: "skill"; prompt: string };
