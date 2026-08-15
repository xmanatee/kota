import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/** Stable filesystem identity for directory-scoped persisted stores. */
export function projectStorageIdentity(projectDir: string): string {
  const resolved = resolve(projectDir || process.cwd());
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}
