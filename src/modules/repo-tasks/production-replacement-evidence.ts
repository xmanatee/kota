import type { ProductionReplacementDeclaration } from "./production-replacement-proof.js";

export type ProductionTestBinding = {
  path: string;
  name: string;
  entrypoints: string[];
};

export type ProductionReplacementArtifact = {
  schemaVersion: 3;
  taskId: string;
  observableEffect: string;
  productionEntrypoints: string[];
  productionTests: string[];
  ingressObservations: Array<{
    ingress: string;
    kind: "live" | "restart";
    test: ProductionTestBinding;
  }>;
  retiredBoundary: {
    check: string;
    tests: ProductionTestBinding[];
  };
};

function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((value) => expected.includes(value));
}

function validateTestBinding(
  binding: ProductionTestBinding | null,
  declaration: ProductionReplacementDeclaration,
): string | null {
  if (
    binding === null ||
    typeof binding !== "object" ||
    typeof binding.path !== "string" ||
    typeof binding.name !== "string" ||
    binding.name.trim().length === 0 ||
    !Array.isArray(binding.entrypoints) ||
    binding.entrypoints.length === 0 ||
    binding.entrypoints.some((path) => typeof path !== "string") ||
    !exactStringSet(binding.entrypoints, [...new Set(binding.entrypoints)])
  ) {
    return "test bindings must contain a declared path, non-empty assertion name, and unique production entrypoints";
  }
  if (!declaration.productionTests.includes(binding.path)) {
    return `test binding path ${JSON.stringify(binding.path)} is not declared in productionTests`;
  }
  const undeclaredEntrypoint = binding.entrypoints.find(
    (path) => !declaration.productionEntrypoints.includes(path),
  );
  return undeclaredEntrypoint === undefined
    ? null
    : `test binding entrypoint ${JSON.stringify(undeclaredEntrypoint)} is not declared in productionEntrypoints`;
}

export function validateProductionReplacementArtifact(
  artifact: ProductionReplacementArtifact | null,
  declaration: ProductionReplacementDeclaration,
  taskId: string,
): string | null {
  if (artifact === null || typeof artifact !== "object") {
    return "evidence artifact must be a JSON object";
  }
  if (artifact.schemaVersion !== 3) return "evidence artifact schemaVersion must be 3";
  if (artifact.taskId !== taskId) return `evidence artifact taskId must be ${taskId}`;
  if (artifact.observableEffect !== declaration.observableEffect) {
    return "evidence artifact observableEffect does not match the task declaration";
  }
  if (
    !Array.isArray(artifact.productionEntrypoints) ||
    artifact.productionEntrypoints.some((path) => typeof path !== "string") ||
    !exactStringSet(
      artifact.productionEntrypoints,
      declaration.productionEntrypoints,
    )
  ) {
    return "evidence artifact must name every declared productionEntrypoints entry exactly once";
  }
  if (
    !Array.isArray(artifact.productionTests) ||
    artifact.productionTests.some((path) => typeof path !== "string")
  ) {
    return "evidence artifact productionTests must be an array of paths";
  }
  if (!exactStringSet(artifact.productionTests, declaration.productionTests)) {
    return "evidence artifact must name every declared productionTests entry exactly once";
  }
  if (!Array.isArray(artifact.ingressObservations)) {
    return "evidence artifact ingressObservations must be an array";
  }
  if (artifact.ingressObservations.some((observation) =>
    observation === null || typeof observation !== "object" ||
    typeof observation.ingress !== "string" ||
    (observation.kind !== "live" && observation.kind !== "restart") ||
    "owner" in observation ||
    "effectObserved" in observation
  )) {
    return "evidence artifact ingressObservations are malformed or contain hand-authored pass flags";
  }
  const expectedIngresses = [
    ...declaration.liveIngresses.map((ingress) => ({ ingress, kind: "live" as const })),
    ...declaration.restartIngresses.map((ingress) => ({ ingress, kind: "restart" as const })),
  ];
  if (artifact.ingressObservations.length !== expectedIngresses.length) {
    return "evidence artifact must report every declared live and restart ingress exactly once";
  }
  for (const expected of expectedIngresses) {
    const matches = artifact.ingressObservations.filter(
      (observed) => observed.ingress === expected.ingress && observed.kind === expected.kind,
    );
    if (matches.length !== 1) {
      return `evidence artifact is missing one ${expected.kind} observation for ${JSON.stringify(expected.ingress)}`;
    }
    const bindingError = validateTestBinding(matches[0]!.test, declaration);
    if (bindingError !== null) {
      return `ingress ${JSON.stringify(expected.ingress)} has an invalid ${bindingError}`;
    }
  }
  if (!artifact.retiredBoundary || typeof artifact.retiredBoundary !== "object" ||
    artifact.retiredBoundary.check !== declaration.retiredPathCheck) {
    return "evidence artifact retiredBoundary check does not match the task declaration";
  }
  if ("reachable" in artifact.retiredBoundary) {
    return "evidence artifact retiredBoundary must bind assertions instead of a hand-authored reachable flag";
  }
  if (
    !Array.isArray(artifact.retiredBoundary.tests) ||
    artifact.retiredBoundary.tests.length === 0
  ) {
    return "evidence artifact retiredBoundary must bind at least one production assertion";
  }
  for (const binding of artifact.retiredBoundary.tests) {
    const bindingError = validateTestBinding(binding, declaration);
    if (bindingError !== null) return `retiredBoundary has an invalid ${bindingError}`;
  }
  const boundTestPaths = [
    ...artifact.ingressObservations.map((observation) => observation.test.path),
    ...artifact.retiredBoundary.tests.map((test) => test.path),
  ];
  const unboundTest = declaration.productionTests.find(
    (testPath) => !boundTestPaths.includes(testPath),
  );
  if (unboundTest !== undefined) {
    return `declared production test has no ingress or retired-boundary proof binding: ${unboundTest}`;
  }
  const boundEntrypoints = [
    ...artifact.ingressObservations.flatMap(
      (observation) => observation.test.entrypoints,
    ),
    ...artifact.retiredBoundary.tests.flatMap((test) => test.entrypoints),
  ];
  const unboundEntrypoint = declaration.productionEntrypoints.find(
    (entrypoint) => !boundEntrypoints.includes(entrypoint),
  );
  return unboundEntrypoint === undefined
    ? null
    : `declared production entrypoint has no ingress or retired-boundary proof binding: ${unboundEntrypoint}`;
}
