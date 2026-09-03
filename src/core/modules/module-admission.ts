import { assertModuleDefinition } from "./module-definition.js";
import type { KotaModule } from "./module-types.js";

export type AdmittedDiscoveredModule = {
  definition: KotaModule;
  source: "bundled" | "installed";
};

export type ModuleDeclarationAdmissionFailure = {
  name: string;
  source: "bundled" | "installed";
  message: string;
};

/**
 * Decode discovered declarations and resolve module identity before any
 * declaration-owned structure is allowed to affect configuration or runtime
 * state. Bundled declarations win an identity collision because they are
 * visited first; the loader reports the rejected declaration from its source.
 */
export function admitDiscoveredModuleDefinitions(
  bundledModules: readonly KotaModule[],
  installedModules: readonly KotaModule[] = [],
): {
  admitted: AdmittedDiscoveredModule[];
  failures: ModuleDeclarationAdmissionFailure[];
} {
  const admittedNames = new Set<string>();
  const admitted: AdmittedDiscoveredModule[] = [];
  const failures: ModuleDeclarationAdmissionFailure[] = [];
  const admit = (
    modules: readonly KotaModule[],
    source: "bundled" | "installed",
  ): void => {
    for (const [index, candidate] of modules.entries()) {
      let name = `<invalid-${source}-${index + 1}>`;
      try {
        const rawName = typeof candidate === "object" &&
            candidate !== null &&
            !Array.isArray(candidate)
          ? (candidate as { name?: unknown }).name
          : undefined;
        if (typeof rawName === "string" && rawName.length > 0) name = rawName;
        assertModuleDefinition(candidate);
        if (admittedNames.has(candidate.name)) {
          throw new Error(
            `Invalid module declaration: duplicate module name "${candidate.name}"`,
          );
        }
        admittedNames.add(candidate.name);
        admitted.push({ definition: candidate, source });
      } catch (error) {
        failures.push({
          name,
          source,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
  admit(bundledModules, "bundled");
  admit(installedModules, "installed");
  return { admitted, failures };
}
