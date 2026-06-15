import { api } from "@/api/client";
import type { ProjectRegistryProjection } from "@/api/types";
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

type ProjectContextValue = {
  projectId: string;
  projects: ProjectRegistryProjection | undefined;
  loading: boolean;
  setProjectId: (projectId: string) => void;
  buildHash: (subRoute: string) => string;
  getSubRoute: () => string;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

const PROJECT_HASH_PREFIX = "p/";

export function parseProjectHash(rawHash: string): {
  projectId: string | null;
  subRoute: string;
} {
  const hash = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
  if (!hash.startsWith(PROJECT_HASH_PREFIX)) {
    return { projectId: null, subRoute: hash };
  }
  const rest = hash.slice(PROJECT_HASH_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash === -1) {
    return { projectId: rest, subRoute: "" };
  }
  return { projectId: rest.slice(0, slash), subRoute: rest.slice(slash + 1) };
}

export function buildProjectHash(projectId: string, subRoute: string): string {
  const trimmed = subRoute.replace(/^\/+/, "");
  return trimmed
    ? `#${PROJECT_HASH_PREFIX}${projectId}/${trimmed}`
    : `#${PROJECT_HASH_PREFIX}${projectId}`;
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const identity = useQuery({
    queryKey: ["identity"],
    queryFn: api.getIdentity,
    staleTime: 60_000,
  });
  const projects = identity.data?.projects;

  const [projectId, setProjectIdState] = useState<string | null>(() => {
    return parseProjectHash(window.location.hash).projectId;
  });

  useEffect(() => {
    const onHashChange = () => {
      const next = parseProjectHash(window.location.hash).projectId;
      if (next !== null) setProjectIdState(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const knownIds = useMemo(() => {
    if (!projects) return null;
    return new Set(projects.projects.map((p) => p.projectId));
  }, [projects]);

  useEffect(() => {
    if (!projects || !knownIds) return;
    if (projectId !== null && knownIds.has(projectId)) return;
    const defaultProjectId = projects.defaultProjectId;
    setProjectIdState(defaultProjectId);
    const { subRoute } = parseProjectHash(window.location.hash);
    const nextHash = buildProjectHash(defaultProjectId, subRoute);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, [projects, knownIds, projectId]);

  const setProjectId = useCallback(
    (next: string) => {
      if (!knownIds || !knownIds.has(next)) {
        throw new Error(`unknown projectId: ${next}`);
      }
      setProjectIdState(next);
      window.location.hash = buildProjectHash(next, "");
    },
    [knownIds],
  );

  const buildHash = useCallback(
    (subRoute: string) => {
      const id = projectId ?? projects?.defaultProjectId ?? "";
      return buildProjectHash(id, subRoute);
    },
    [projectId, projects],
  );

  const getSubRoute = useCallback(() => {
    return parseProjectHash(window.location.hash).subRoute;
  }, []);

  const value = useMemo<ProjectContextValue>(() => {
    return {
      projectId: projectId ?? "",
      projects,
      loading: identity.isPending,
      setProjectId,
      buildHash,
      getSubRoute,
    };
  }, [
    projectId,
    projects,
    identity.isPending,
    setProjectId,
    buildHash,
    getSubRoute,
  ]);

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProjectContext must be used inside <ProjectProvider>");
  }
  return ctx;
}

/**
 * The active projectId. Returns an empty string before the registry has
 * loaded; consumers that pass this into a query factory should rely on
 * `enabled: projectId !== ""` (the factories below already handle that).
 */
export function useProjectId(): string {
  return useProjectContext().projectId;
}

/**
 * Test-only provider. Bypasses the daemon `/identity` round-trip so unit
 * tests can render project-scoped components in isolation. Production code
 * always uses {@link ProjectProvider}.
 */
export function TestProjectProvider({
  children,
  projectId = "test",
  projects = {
    defaultProjectId: "test",
    projects: [
      { projectId: "test", projectDir: "/tmp/test", displayName: "Test" },
    ],
  },
}: {
  children: ReactNode;
  projectId?: string;
  projects?: ProjectRegistryProjection;
}) {
  const value = useMemo<ProjectContextValue>(() => {
    return {
      projectId,
      projects,
      loading: false,
      setProjectId: () => {},
      buildHash: (sub: string) => buildProjectHash(projectId, sub),
      getSubRoute: () => parseProjectHash(window.location.hash).subRoute,
    };
  }, [projectId, projects]);
  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}
