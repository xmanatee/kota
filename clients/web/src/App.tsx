import { uiSurfacesQuery } from "@/api/queries";
import { ChatArea } from "@/components/chat/ChatArea";
import { SharedUiSurface } from "@/components/shared-ui/SharedUiSurface";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { useDaemonEvents } from "@/hooks/use-daemon-events";
import {
  ProjectProvider,
  parseProjectHash,
  useProjectContext,
} from "@/lib/project-context";
import { cn } from "@/lib/utils";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { Menu } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5000,
    },
  },
});

function AppContent() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    window.innerWidth <= 768,
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(
    () => {
      const { subRoute } = parseProjectHash(window.location.hash);
      return subRoute.startsWith("surface/")
        ? decodeURIComponent(subRoute.slice("surface/".length))
        : null;
    },
  );
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem("kota-theme");
    return stored
      ? stored === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  const { projectId, buildHash } = useProjectContext();
  const uiSurfaces = useQuery(uiSurfacesQuery(projectId));
  const daemonEvents = useDaemonEvents(uiSurfaces.data);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("kota-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    const applyHash = () => {
      const { subRoute } = parseProjectHash(window.location.hash);
      if (subRoute.startsWith("surface/")) {
        setSelectedSurfaceId(
          decodeURIComponent(subRoute.slice("surface/".length)),
        );
        return;
      }
      setSelectedSurfaceId(null);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  // When the active project changes, reset in-project view state — runs and
  // history ids are project-scoped, so carrying them across a switch would
  // render a "not found" view in the new project.
  useEffect(() => {
    if (projectId === "") return;
    setSessionId(null);
    setSelectedSurfaceId(null);
  }, [projectId]);

  useEffect(() => {
    if (!selectedSurfaceId || !uiSurfaces.data) return;
    if (
      !uiSurfaces.data.surfaces.some(
        (surface) => surface.surfaceId === selectedSurfaceId,
      )
    ) {
      setSelectedSurfaceId(null);
      window.location.hash = buildHash("");
    }
  }, [buildHash, selectedSurfaceId, uiSurfaces.data]);

  const showChat = useCallback(() => {
    setSelectedSurfaceId(null);
    window.location.hash = buildHash("");
  }, [buildHash]);

  const handleSurfaceSelect = useCallback(
    (surfaceId: string) => {
      setSelectedSurfaceId(surfaceId);
      window.location.hash = buildHash(
        `surface/${encodeURIComponent(surfaceId)}`,
      );
      if (window.innerWidth <= 768) setSidebarCollapsed(true);
    },
    [buildHash],
  );

  const handleNewChat = useCallback(() => {
    setSessionId(null);
    showChat();
  }, [showChat]);

  const handleSessionSelect = useCallback(
    (nextSessionId: string) => {
      setSessionId(nextSessionId);
      showChat();
      if (window.innerWidth <= 768) setSidebarCollapsed(true);
    },
    [showChat],
  );

  const selectedSurface = uiSurfaces.data?.surfaces.find(
    (surface) => surface.surfaceId === selectedSurfaceId,
  );
  const mainContent = selectedSurface ? (
    <SharedUiSurface
      surface={selectedSurface}
      onNavigate={handleSurfaceSelect}
      onSessionSelect={handleSessionSelect}
      liveLogEntries={daemonEvents.liveLogEntries}
    />
  ) : (
    <ChatArea sessionId={sessionId} onSessionCreated={setSessionId} />
  );

  return (
    <div className="flex h-screen">
      <button
        type="button"
        className={cn(
          "fixed left-3 top-3 z-50 flex size-11 items-center justify-center rounded-md border border-border bg-card text-sm shadow-sm md:hidden",
          !sidebarCollapsed && "hidden",
        )}
        onClick={() => setSidebarCollapsed(false)}
        aria-label="Open navigation"
      >
        <Menu aria-hidden="true" />
      </button>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
        onNewChat={handleNewChat}
        connectionStatus={daemonEvents.status}
        darkMode={darkMode}
        onToggleTheme={() => setDarkMode((d) => !d)}
        uiBundle={uiSurfaces.data}
        uiLoading={uiSurfaces.isPending}
        uiError={uiSurfaces.error}
        selectedSurfaceId={selectedSurfaceId}
        onSurfaceSelect={handleSurfaceSelect}
      />
      <main
        className={cn(
          "min-w-0 flex-1 overflow-y-auto",
          sidebarCollapsed ? "" : "md:ml-0",
        )}
      >
        {mainContent}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ProjectProvider>
        <AppContent />
      </ProjectProvider>
    </QueryClientProvider>
  );
}
