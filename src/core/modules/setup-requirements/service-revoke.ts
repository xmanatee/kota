import type {
  ModuleSetupActionFile,
  ModuleSetupPendingAction,
  ModuleSetupRequirementContribution,
} from "./types.js";

export function revokedActionFile(args: {
  file: ModuleSetupActionFile;
  found: ModuleSetupRequirementContribution;
  moduleName: string;
  requirementId: string;
  revokedAt: string;
  actionIdTimeMs: number;
}): ModuleSetupActionFile {
  const existing = args.file.actions.filter(
    (candidate) =>
      candidate.moduleName === args.moduleName &&
      candidate.requirementId === args.requirementId,
  );
  const synthetic =
    existing.length === 0 && args.found.requirement.setup.mode === "url"
      ? [syntheticRevocation(args)]
      : [];
  return {
    actions: [
      ...args.file.actions.map((candidate) =>
        candidate.moduleName === args.moduleName &&
        candidate.requirementId === args.requirementId
          ? { ...candidate, status: "revoked" as const, completedAt: args.revokedAt }
          : candidate,
      ),
      ...synthetic,
    ],
  };
}

function syntheticRevocation(args: {
  found: ModuleSetupRequirementContribution;
  revokedAt: string;
  actionIdTimeMs: number;
}): ModuleSetupPendingAction {
  if (args.found.requirement.setup.mode !== "url") throw new Error("expected url setup");
  return {
    actionId: `${args.found.moduleName}.${args.found.requirement.id}.revoked.${args.actionIdTimeMs}`,
    moduleName: args.found.moduleName,
    requirementId: args.found.requirement.id,
    label: args.found.requirement.setup.label,
    status: "revoked",
    createdAt: args.revokedAt,
    expiresAt: args.revokedAt,
    completedAt: args.revokedAt,
  };
}
