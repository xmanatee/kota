import { projectSetupStatusOntoManifest } from "./module-manifest.js";
import type { ModuleSummary } from "./module-types.js";
import {
  type ModuleSetupCapabilityStatus,
  type ModuleSetupRequirementContribution,
  type ModuleSetupRequirementStatus,
  ModuleSetupService,
  type ModuleSetupStatusResponse,
} from "./setup-requirements.js";

export function moduleSetupRequirementsFromSummaries(
  summaries: readonly ModuleSummary[],
): ModuleSetupRequirementContribution[] {
  return summaries.flatMap((summary) => {
    const setupRequirements = summary.setupRequirements ?? [];
    return (summary.manifest?.contributions.setupRequirements ?? []).map((snapshot) => {
      const requirement = setupRequirements.find((candidate) =>
        candidate.id === snapshot.id
      );
      if (requirement === undefined) {
        throw new Error(
          `Module "${summary.name}" manifest setup requirement "${snapshot.id}" has no setup declaration`,
        );
      }
      return {
        moduleName: summary.name,
        requirement,
      };
    });
  });
}

export async function listModuleSetupStatusesFromSummaries(args: {
  projectDir: string;
  getModuleSummaries: () => readonly ModuleSummary[];
  probeCapabilities: () => Promise<readonly ModuleSetupCapabilityStatus[]>;
}): Promise<ModuleSetupStatusResponse> {
  const service = new ModuleSetupService({
    projectDir: args.projectDir,
    getRequirements: () => moduleSetupRequirementsFromSummaries(args.getModuleSummaries()),
    probeCapabilities: args.probeCapabilities,
  });
  return service.list();
}

export function moduleSummariesWithSetupAvailability(
  summaries: readonly ModuleSummary[],
  statuses: readonly ModuleSetupRequirementStatus[],
): ModuleSummary[] {
  return summaries.map((summary) => {
    if (summary.manifest === undefined) return summary;
    return {
      ...summary,
      manifest: projectSetupStatusOntoManifest(summary.manifest, statuses),
    };
  });
}
