import { createRequire } from "node:module";
import { resolve } from "node:path";

const requireFromHere = createRequire(import.meta.url);

export function isPlaywrightAvailable(scopeRoot: string = process.cwd()): boolean {
  try {
    const requireFromScope = createRequire(resolve(scopeRoot, "package.json"));
    requireFromScope.resolve("playwright");
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
