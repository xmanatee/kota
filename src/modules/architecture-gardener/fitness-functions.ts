import type { ArchitectureObservation, ArchitectureSignal } from "./types.js";

export type ArchitecturalFitnessReport = {
  readonly timestamp: string;
  readonly passed: boolean;
  readonly protectedInvariantsSatisfied: boolean;
  readonly violations: {
    readonly forbiddenCoreDependencies: number;
    readonly undeclaredModuleImports: number;
    readonly moduleDependencyCycles: number;
    readonly duplicateCanonicalOwnerships: number;
  };
  readonly signals: readonly ArchitectureSignal[];
};

/**
 * Classify an ArchitectureObservation into a typed ArchitectureSignal.
 */
export function observationToSignal(obs: ArchitectureObservation): ArchitectureSignal {
  let kind: ArchitectureSignal["kind"];
  if (
    obs.kind === "forbidden-core-to-module-dependency" ||
    obs.kind === "undeclared-runtime-cross-module-import" ||
    obs.kind === "module-dependency-cycle" ||
    obs.kind === "duplicate-canonical-ownership"
  ) {
    kind = "structural-violation";
  } else if (obs.kind === "explicit-owner-request") {
    kind = "explicit-request";
  } else {
    kind = "advisory-metric";
  }

  return {
    id: `sig-${obs.id}`,
    kind,
    category: obs.category,
    targetScope: obs.targetScope,
    summary: obs.summary,
    fingerprint: obs.fingerprint,
    evidence: obs.evidence,
  };
}

/**
 * Evaluate architectural fitness functions across collected observations.
 * Protected invariants:
 * - zero forbidden core-to-module dependencies
 * - zero undeclared cross-module imports
 * - zero module dependency cycles
 * - zero duplicate canonical ownership
 */
export function evaluateArchitecturalFitness(
  observations: readonly ArchitectureObservation[],
): ArchitecturalFitnessReport {
  let forbiddenCoreDependencies = 0;
  let undeclaredModuleImports = 0;
  let moduleDependencyCycles = 0;
  let duplicateCanonicalOwnerships = 0;

  const signals = observations.map(observationToSignal);

  for (const obs of observations) {
    switch (obs.kind) {
      case "forbidden-core-to-module-dependency":
        forbiddenCoreDependencies += 1;
        break;
      case "undeclared-runtime-cross-module-import":
        undeclaredModuleImports += 1;
        break;
      case "module-dependency-cycle":
        moduleDependencyCycles += 1;
        break;
      case "duplicate-canonical-ownership":
        duplicateCanonicalOwnerships += 1;
        break;
    }
  }

  const protectedInvariantsSatisfied =
    forbiddenCoreDependencies === 0 &&
    undeclaredModuleImports === 0 &&
    moduleDependencyCycles === 0 &&
    duplicateCanonicalOwnerships === 0;

  return {
    timestamp: new Date().toISOString(),
    passed: protectedInvariantsSatisfied,
    protectedInvariantsSatisfied,
    violations: {
      forbiddenCoreDependencies,
      undeclaredModuleImports,
      moduleDependencyCycles,
      duplicateCanonicalOwnerships,
    },
    signals,
  };
}
