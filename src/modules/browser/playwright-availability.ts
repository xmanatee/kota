import { createRequire } from "node:module";
import { resolve } from "node:path";

const requireFromHere = createRequire(import.meta.url);

export function isPlaywrightAvailable(projectDir: string = process.cwd()): boolean {
  try {
    const requireFromProject = createRequire(resolve(projectDir, "package.json"));
    requireFromProject.resolve("playwright");
    return true;
  } catch {
    // Fall back to the module install location below.
  }

  try {
    requireFromHere.resolve("playwright");
    return true;
  } catch {
    return false;
  }
}
