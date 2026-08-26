import { api } from "@/api/client";
import type { ScopeRegistryProjection } from "@/api/types";
import { useQuery } from "@tanstack/react-query";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type ScopeContextValue = {
  scopeId: string;
  scopeRegistry: ScopeRegistryProjection | undefined;
  loading: boolean;
  setScopeId: (scopeId: string) => void;
  buildHash: (subRoute: string) => string;
  getSubRoute: () => string;
};

const ScopeContext = createContext<ScopeContextValue | null>(null);

const SCOPE_HASH_PREFIX = "s/";

export function parseScopeHash(rawHash: string): {
  scopeId: string | null;
  subRoute: string;
} {
  const hash = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
  if (!hash.startsWith(SCOPE_HASH_PREFIX)) {
    return { scopeId: null, subRoute: hash };
  }
  const rest = hash.slice(SCOPE_HASH_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash === -1) {
    return { scopeId: rest, subRoute: "" };
  }
  return { scopeId: rest.slice(0, slash), subRoute: rest.slice(slash + 1) };
}

export function buildScopeHash(scopeId: string, subRoute: string): string {
  const trimmed = subRoute.replace(/^\/+/, "");
  return trimmed
    ? `#${SCOPE_HASH_PREFIX}${scopeId}/${trimmed}`
    : `#${SCOPE_HASH_PREFIX}${scopeId}`;
}

export function ScopeProvider({ children }: { children: ReactNode }) {
  const identity = useQuery({
    queryKey: ["identity"],
    queryFn: api.getIdentity,
    staleTime: 60_000,
  });
  const scopeRegistry = identity.data?.scopeRegistry;

  const [scopeId, setScopeIdState] = useState<string | null>(() => {
    return parseScopeHash(window.location.hash).scopeId;
  });

  useEffect(() => {
    const onHashChange = () => {
      const next = parseScopeHash(window.location.hash).scopeId;
      if (next !== null) setScopeIdState(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const knownIds = useMemo(() => {
    if (!scopeRegistry) return null;
    return new Set(
      scopeRegistry.scopes
        .filter((scope) => scope.directoryRoot !== undefined)
        .map((scope) => scope.scopeId),
    );
  }, [scopeRegistry]);

  useEffect(() => {
    if (!scopeRegistry || !knownIds) return;
    if (scopeId !== null && knownIds.has(scopeId)) return;
    const defaultScopeId = scopeRegistry.defaultScopeId;
    setScopeIdState(defaultScopeId);
    const { subRoute } = parseScopeHash(window.location.hash);
    const nextHash = buildScopeHash(defaultScopeId, subRoute);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, [scopeRegistry, knownIds, scopeId]);

  const setScopeId = useCallback(
    (next: string) => {
      if (!knownIds || !knownIds.has(next)) {
        throw new Error(`unknown scopeId: ${next}`);
      }
      setScopeIdState(next);
      window.location.hash = buildScopeHash(next, "");
    },
    [knownIds],
  );

  const buildHash = useCallback(
    (subRoute: string) => {
      const id = scopeId ?? scopeRegistry?.defaultScopeId ?? "";
      return buildScopeHash(id, subRoute);
    },
    [scopeId, scopeRegistry],
  );

  const getSubRoute = useCallback(() => {
    return parseScopeHash(window.location.hash).subRoute;
  }, []);

  const value = useMemo<ScopeContextValue>(() => {
    return {
      scopeId: scopeId ?? "",
      scopeRegistry,
      loading: identity.isPending,
      setScopeId,
      buildHash,
      getSubRoute,
    };
  }, [
    scopeId,
    scopeRegistry,
    identity.isPending,
    setScopeId,
    buildHash,
    getSubRoute,
  ]);

  return (
    <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
  );
}

export function useScopeContext(): ScopeContextValue {
  const ctx = useContext(ScopeContext);
  if (!ctx) {
    throw new Error("useScopeContext must be used inside <ScopeProvider>");
  }
  return ctx;
}

/**
 * The active scopeId. Returns an empty string before the registry has
 * loaded; consumers that pass this into a query factory should rely on
 * `enabled: scopeId !== ""` (the factories below already handle that).
 */
export function useScopeId(): string {
  return useScopeContext().scopeId;
}

/**
 * Test-only provider. Bypasses the daemon `/identity` round-trip so unit
 * tests can render scope-bound components in isolation. Production code
 * always uses {@link ScopeProvider}.
 */
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
  const value = useMemo<ScopeContextValue>(() => {
    return {
      scopeId,
      scopeRegistry,
      loading: false,
      setScopeId: () => {},
      buildHash: (sub: string) => buildScopeHash(scopeId, sub),
      getSubRoute: () => parseScopeHash(window.location.hash).subRoute,
    };
  }, [scopeId, scopeRegistry]);
  return (
    <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
  );
}
