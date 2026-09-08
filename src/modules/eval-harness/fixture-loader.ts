
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFixtureSpec } from "./fixture-spec-parser.js";
import type { LoadedFixture } from "./fixture-spec-types.js";

/**
 * Load a single fixture by id from the fixtures root. Fails loudly when the
 * directory layout is wrong — silent skips would hide eval coverage gaps.
 */
export function loadFixture(fixturesRoot: string, id: string): LoadedFixture {
  const fixtureDir = join(fixturesRoot, id);
  if (!existsSync(fixtureDir) || !statSync(fixtureDir).isDirectory()) {
    throw new Error(`Fixture "${id}" not found under "${fixturesRoot}".`);
  }
  const specPath = join(fixtureDir, "fixture.json");
  if (!existsSync(specPath)) {
    throw new Error(`Fixture "${id}" missing fixture.json at "${specPath}".`);
  }
  if (existsSync(join(fixtureDir, "recordings")) && readdirSync(join(fixtureDir, "recordings")).length > 0) {
    throw new Error(`Fixture "${id}" contains unsupported agent recordings; capability evaluations require live models.`);
  }
  const spec = parseFixtureSpec(readFileSync(specPath, "utf-8"), fixtureDir);
  if (spec.id !== id) {
    throw new Error(
      `Fixture directory "${id}" has mismatched fixture.id="${spec.id}".`,
    );
  }
  const initialStateDir = join(fixtureDir, "initial");
  if (!existsSync(initialStateDir) || !statSync(initialStateDir).isDirectory()) {
    throw new Error(
      `Fixture "${id}" missing required initial/ directory at "${initialStateDir}".`,
    );
  }
  return { spec, fixtureDir, initialStateDir };
}

/**
 * Load every fixture discoverable under the fixtures root. A fixture is any
 * subdirectory containing a fixture.json file; other entries are ignored so
 * operators can keep notes or helpers alongside fixtures without failing
 * discovery.
 */
export function loadAllFixtures(fixturesRoot: string): LoadedFixture[] {
  if (!existsSync(fixturesRoot)) return [];
  const entries = readdirSync(fixturesRoot, { withFileTypes: true });
  const fixtures: LoadedFixture[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const specPath = join(fixturesRoot, entry.name, "fixture.json");
    if (!existsSync(specPath)) continue;
    fixtures.push(loadFixture(fixturesRoot, entry.name));
  }
  return fixtures.sort((a, b) => a.spec.id.localeCompare(b.spec.id));
}
