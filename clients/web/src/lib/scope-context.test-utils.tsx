import type { ScopeRegistryProjection } from "@/api/types";
import type { ReactNode } from "react";
import {
  ScopeContextProvider,
  type ScopeContextValue,
  buildScopeHash,
  parseScopeHash,
} from "./scope-context";

export function TestScopeProvider({
  children,
  scopeId = "test",
  scopeRegistry = {
    rootScopeId: "global",
    defaultScopeId: "test",
    scopes: [
      { scopeId: "global", displayName: "Global" },
      {
        scopeId: "test",
        parentScopeId: "global",
        directoryRoot: "/tmp/test",
        displayName: "Test",
      },
    ],
  },
}: {
  children: ReactNode;
  scopeId?: string;
  scopeRegistry?: ScopeRegistryProjection;
}) {
  const value: ScopeContextValue = {
    scopeId,
    scopeRegistry,
    loading: false,
    setScopeId: () => {},
    buildHash: (subRoute) => buildScopeHash(scopeId, subRoute),
    getSubRoute: () => parseScopeHash(window.location.hash).subRoute,
  };
  return <ScopeContextProvider value={value}>{children}</ScopeContextProvider>;
}
