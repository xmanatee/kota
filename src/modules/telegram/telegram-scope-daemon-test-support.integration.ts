import type { DirectoryScope } from "#core/daemon/scope-registry.js";

export const SCOPE_A: DirectoryScope = {
  scopeId: "scope-a",
  scopeRoot: "/tmp/scope-a",
  displayName: "Scope A",
};

export const SCOPE_B: DirectoryScope = {
  scopeId: "scope-b",
  scopeRoot: "/tmp/scope-b",
  displayName: "Scope B",
};
