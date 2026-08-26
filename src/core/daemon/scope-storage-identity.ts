import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/** Stable filesystem identity for directory-scoped persisted stores. */
export function scopeStorageIdentity(scopeRoot: string): string {
  const resolved = resolve(scopeRoot || process.cwd());
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}
