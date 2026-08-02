import {
  existsSync,
  lstatSync,
  readFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { decodeScopeAuthorityMetadata } from "./scope-authority-codec.js";
import { withAuthorityCommitLock } from "./scope-authority-lock.js";
import type {
  ScopeAuthorityPersistence,
  ScopeAuthorityStoredState,
} from "./scope-authority-types.js";
import { decodeScopePolicyFragments } from "./scope-policy-codec.js";

type BoundaryValue = unknown;
type GlobalConfigRecord = { [key: string]: BoundaryValue };

export class ScopeAuthorityRevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super(`Scope authority revision changed to ${currentRevision}`);
    this.name = "ScopeAuthorityRevisionConflictError";
  }
}

export class ScopeAuthorityStore implements ScopeAuthorityPersistence {
  constructor(readonly configPath: string) {}

  read(): ScopeAuthorityStoredState {
    const raw = readGlobalConfig(this.configPath);
    const trustedProjects = decodeTrustedProjects(raw.trustedProjects);
    const policies = raw.scopePolicies === undefined
      ? { ok: true as const, value: [] }
      : decodeScopePolicyFragments(raw.scopePolicies);
    if (!policies.ok) throw new Error(`${this.configPath}: ${policies.error}`);
    const metadata = decodeScopeAuthorityMetadata(raw.scopeAuthority);
    if (!metadata.ok) throw new Error(`${this.configPath}: ${metadata.error}`);
    return {
      trustedProjects,
      scopePolicies: policies.value,
      metadata: metadata.value,
    };
  }

  async commit(
    expectedRevision: number,
    next: ScopeAuthorityStoredState,
  ): Promise<ScopeAuthorityStoredState> {
    return withAuthorityCommitLock(this.configPath, async () => {
      const current = this.read();
      if (current.metadata.revision !== expectedRevision) {
        throw new ScopeAuthorityRevisionConflictError(current.metadata.revision);
      }
      if (next.metadata.revision !== expectedRevision + 1) {
        throw new Error("Scope authority commits must advance revision by exactly one");
      }
      const raw = readGlobalConfig(this.configPath);
      const updated: GlobalConfigRecord = {
        ...raw,
        ...(next.trustedProjects.length > 0
          ? { trustedProjects: [...next.trustedProjects] }
          : { trustedProjects: undefined }),
        ...(next.scopePolicies.length > 0
          ? { scopePolicies: [...next.scopePolicies] }
          : { scopePolicies: undefined }),
        scopeAuthority: next.metadata,
      };
      assertPrivateRegularDestination(this.configPath);
      writeJsonFileAtomic(this.configPath, updated, undefined, { mode: 0o600 });
      return this.read();
    });
  }
}

function decodeTrustedProjects(raw: BoundaryValue): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("trustedProjects must be an array");
  const paths = raw.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`trustedProjects[${index}] must be a non-empty string`);
    }
    return entry;
  });
  if (new Set(paths).size !== paths.length) {
    throw new Error("trustedProjects must not contain duplicates");
  }
  return paths;
}

function readGlobalConfig(path: string): GlobalConfigRecord {
  assertPrivateRegularDestination(path);
  if (!existsSync(path)) return {};
  let parsed: BoundaryValue;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path}: invalid global config JSON: ${message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path}: global config must be a JSON object`);
  }
  return parsed as GlobalConfigRecord;
}

function assertPrivateRegularDestination(path: string): void {
  if (!existsSync(path)) {
    const parent = dirname(path);
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) {
      throw new Error(`${parent}: global config directory may not be a symbolic link`);
    }
    return;
  }
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) {
    throw new Error(`${path}: global config may not be a symbolic link`);
  }
  if (!stats.isFile()) throw new Error(`${path}: global config must be a regular file`);
}
