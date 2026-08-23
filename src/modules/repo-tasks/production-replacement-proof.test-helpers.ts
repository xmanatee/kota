import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export const REPLACEMENT_TASK_ID = "task-replace-runtime-ingress";
export const REPLACEMENT_OWNER = "runtime owner";
export const REPLACEMENT_TEST_PATHS = [
  "src/live-runtime.integration.test.ts",
  "src/restart-runtime.integration.test.ts",
] as const;
export const REPLACEMENT_ENTRYPOINT_PATHS = [
  "src/live-runtime.ts",
  "src/restart-runtime.ts",
] as const;
export const REPLACEMENT_TEST_NAMES = [
  "production replacement fixture observes live owner-bound effects",
  "production replacement fixture rejects the retired boundary after restart",
] as const;
export const REPLACEMENT_EVIDENCE_PATH =
  ".kota/runs/run-replacement/evidence/artifacts/production-replacement-proof.json";

export function linkReplacementFixtureDependencies(projectDir: string): void {
  const nodeModulesDir = join(projectDir, "node_modules");
  const binDir = join(nodeModulesDir, ".bin");
  mkdirSync(binDir, { recursive: true });
  symlinkSync(
    realpathSync(join(REPOSITORY_ROOT, "node_modules/vitest")),
    join(nodeModulesDir, "vitest"),
    "dir",
  );
  symlinkSync(
    realpathSync(join(REPOSITORY_ROOT, "node_modules/vitest/vitest.mjs")),
    join(binDir, "vitest"),
    "file",
  );
}

export function replacementDeclaration(
  overrides: Partial<Record<string, string>> = {},
): string {
  const fields = {
    oldBoundary: "legacy runtime ingress",
    replacementOwner: REPLACEMENT_OWNER,
    liveIngresses: "daemon startup | live event delivery",
    restartIngresses: "persisted queue restore",
    observableEffect: "the new owner receives live and restored traffic",
    productionEntrypoints: REPLACEMENT_ENTRYPOINT_PATHS.join(" | "),
    productionTests: REPLACEMENT_TEST_PATHS.join(" | "),
    retiredPathCheck: "legacy ingress is unreachable from live and restored state",
    evidenceArtifact: REPLACEMENT_EVIDENCE_PATH,
    ...overrides,
  };
  return [
    "## Production Replacement Proof",
    "",
    ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
  ].join("\n");
}

export function replacementArtifact(overrides: object = {}) {
  return {
    schemaVersion: 3,
    taskId: REPLACEMENT_TASK_ID,
    observableEffect: "the new owner receives live and restored traffic",
    productionEntrypoints: [...REPLACEMENT_ENTRYPOINT_PATHS],
    productionTests: [...REPLACEMENT_TEST_PATHS],
    ingressObservations: [
      {
        ingress: "daemon startup",
        kind: "live",
        test: {
          path: REPLACEMENT_TEST_PATHS[0],
          name: REPLACEMENT_TEST_NAMES[0],
          entrypoints: [REPLACEMENT_ENTRYPOINT_PATHS[0]],
        },
      },
      {
        ingress: "live event delivery",
        kind: "live",
        test: {
          path: REPLACEMENT_TEST_PATHS[0],
          name: REPLACEMENT_TEST_NAMES[0],
          entrypoints: [REPLACEMENT_ENTRYPOINT_PATHS[0]],
        },
      },
      {
        ingress: "persisted queue restore",
        kind: "restart",
        test: {
          path: REPLACEMENT_TEST_PATHS[1],
          name: REPLACEMENT_TEST_NAMES[1],
          entrypoints: [REPLACEMENT_ENTRYPOINT_PATHS[1]],
        },
      },
    ],
    retiredBoundary: {
      check: "legacy ingress is unreachable from live and restored state",
      tests: [
        {
          path: REPLACEMENT_TEST_PATHS[0],
          name: REPLACEMENT_TEST_NAMES[0],
          entrypoints: [REPLACEMENT_ENTRYPOINT_PATHS[0]],
        },
        {
          path: REPLACEMENT_TEST_PATHS[1],
          name: REPLACEMENT_TEST_NAMES[1],
          entrypoints: [REPLACEMENT_ENTRYPOINT_PATHS[1]],
        },
      ],
    },
    ...overrides,
  };
}

export function writeReplacementProofFixture(
  projectDir: string,
  value: object = replacementArtifact(),
): void {
  const entrypointSources = [
    `export function exerciseLiveAssembly() {
  const ownerReceived: string[] = [];
  const retiredReceived: string[] = [];
  const replacementOwner = (value: string) => ownerReceived.push(value);
  replacementOwner("startup");
  replacementOwner("event");
  return { ownerReceived, retiredReceived };
}
`,
    `export function exerciseRestartAssembly() {
  const persisted = [
    { id: "manual", admitted: true },
    { id: "obsolete", admitted: false },
  ];
  const restored = persisted.filter((entry) => entry.admitted);
  return { restored, obsoleteRestored: restored.some((entry) => entry.id === "obsolete") };
}
`,
  ];
  for (const [index, entrypointPath] of REPLACEMENT_ENTRYPOINT_PATHS.entries()) {
    const absolute = join(projectDir, entrypointPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, entrypointSources[index]);
  }
  for (const [index, testPath] of REPLACEMENT_TEST_PATHS.entries()) {
    const absolute = join(projectDir, testPath);
    mkdirSync(dirname(absolute), { recursive: true });
    const marker = index === 0
      ? "writeFileSync('declared-production-tests-ran', 'yes');"
      : "";
    const fixture = index === 0
      ? `import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { exerciseLiveAssembly } from "./live-runtime.js";

it(${JSON.stringify(REPLACEMENT_TEST_NAMES[index])}, () => {
  const result = exerciseLiveAssembly();
  expect(result.ownerReceived).toEqual(["startup", "event"]);
  expect(result.retiredReceived).toEqual([]);
  ${marker}
});
`
      : `import { expect, it } from "vitest";
import { exerciseRestartAssembly } from "./restart-runtime.js";

it(${JSON.stringify(REPLACEMENT_TEST_NAMES[index])}, () => {
  const result = exerciseRestartAssembly();
  expect(result.restored).toEqual([{ id: "manual", admitted: true }]);
  expect(result.obsoleteRestored).toBe(false);
});
`;
    writeFileSync(absolute, fixture);
  }
  const evidencePath = join(projectDir, REPLACEMENT_EVIDENCE_PATH);
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, JSON.stringify(value));
}

export function writeSyntheticReplacementProofFixture(projectDir: string): void {
  writeReplacementProofFixture(projectDir);
  for (const [index, testPath] of REPLACEMENT_TEST_PATHS.entries()) {
    writeFileSync(
      join(projectDir, testPath),
      `import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { exerciseLiveAssembly } from "./live-runtime.js";
import { exerciseRestartAssembly } from "./restart-runtime.js";

it(${JSON.stringify(REPLACEMENT_TEST_NAMES[index])}, () => {
  const observedOwner = ${JSON.stringify(REPLACEMENT_OWNER)};
  expect(observedOwner).toBe(${JSON.stringify(REPLACEMENT_OWNER)});
  ${index === 0 ? "writeFileSync('declared-production-tests-ran', 'yes');" : ""}
});
`,
    );
  }
}

export function normalizedReplacementTask(
  status: "doing" | "done",
  body: string,
): string {
  return `---
id: ${REPLACEMENT_TASK_ID}
title: Replace a cross-cutting runtime ingress
status: ${status}
priority: p1
area: architecture
task_class: Platform
production_replacement: true
summary: Route live and restored traffic through one owner.
created_at: 2026-08-23T00:00:00.000Z
updated_at: 2026-08-23T00:00:00.000Z
---

## Problem

The old ingress remains reachable.

## Desired Outcome

One owner receives production traffic.

## Constraints

Use production composition roots.

## Done When

- Live and restored traffic use one owner.

## Source / Intent

Production recovery exposed an incomplete replacement.

## Initiative

Production-proven single-mechanism architecture.

## Acceptance Evidence

- Production lifecycle fixtures and a reachability artifact prove completion.

${body}
`;
}
