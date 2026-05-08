import { ChatArea } from "@/components/chat/ChatArea";
import { HistoryView } from "@/components/chat/HistoryView";
import { RunCompare } from "@/components/run-detail/RunCompare";
import { RunDetail } from "@/components/run-detail/RunDetail";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { useDaemonEvents } from "@/hooks/use-daemon-events";
import {
  ProjectProvider,
  parseProjectHash,
  useProjectContext,
} from "@/lib/project-context";
import { cn } from "@/lib/utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const [comparingRunIds, setComparingRunIds] = useState<
    [string, string] | null
  >(null);
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem("kota-theme");
    return stored
      ? stored === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  const connectionStatus = useDaemonEvents();
  const { projectId, buildHash } = useProjectContext();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("kota-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    const applyHash = () => {
      const { subRoute } = parseProjectHash(window.location.hash);
      if (subRoute.startsWith("compare/")) {
        const ids = subRoute.slice("compare/".length).split("/");
        if (ids.length === 2 && ids[0] && ids[1]) {
          setComparingRunIds([ids[0], ids[1]]);
          setViewingRunId(null);
          setViewingHistoryId(null);
          return;
        }
      }
      if (subRoute.startsWith("run/")) {
        setViewingRunId(subRoute.slice("run/".length));
        setComparingRunIds(null);
        setViewingHistoryId(null);
        return;
      }
      setViewingRunId(null);
      setComparingRunIds(null);
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
    setViewingHistoryId(null);
    setViewingRunId(null);
    setComparingRunIds(null);
  }, [projectId]);

  const showChat = useCallback(() => {
    setViewingHistoryId(null);
    setViewingRunId(null);
    setComparingRunIds(null);
    window.location.hash = buildHash("");
  }, [buildHash]);

  const handleRunSelect = useCallback(
    (id: string) => {
      setViewingRunId(id);
      setViewingHistoryId(null);
      setComparingRunIds(null);
      window.location.hash = buildHash(`run/${id}`);
    },
    [buildHash],
  );

  const handleCompareRuns = useCallback(
    (idA: string, idB: string) => {
      setComparingRunIds([idA, idB]);
      setViewingRunId(null);
      setViewingHistoryId(null);
      window.location.hash = buildHash(`compare/${idA}/${idB}`);
    },
    [buildHash],
  );

  const handleHistorySelect = useCallback((id: string) => {
    setViewingHistoryId(id);
    setViewingRunId(null);
  }, []);

  const handleNewChat = useCallback(() => {
    setSessionId(null);
    showChat();
  }, [showChat]);

  let mainContent: React.ReactNode;
  if (comparingRunIds) {
    mainContent = (
      <RunCompare
        runIdA={comparingRunIds[0]}
        runIdB={comparingRunIds[1]}
        onClose={showChat}
      />
    );
  } else if (viewingRunId) {
    mainContent = <RunDetail runId={viewingRunId} onClose={showChat} />;
  } else if (viewingHistoryId) {
    mainContent = <HistoryView id={viewingHistoryId} onBack={showChat} />;
  } else {
    mainContent = (
      <ChatArea sessionId={sessionId} onSessionCreated={setSessionId} />
    );
  }

  return (
    <div className="flex h-screen">
      <button
        type="button"
        className={cn(
          "fixed left-3 top-3 z-50 rounded border border-border bg-card p-1.5 text-sm md:hidden",
          !sidebarCollapsed && "hidden",
        )}
        onClick={() => setSidebarCollapsed(false)}
      >
        ☰
      </button>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
        activeSessionId={sessionId}
        onSessionSelect={setSessionId}
        onHistorySelect={handleHistorySelect}
        onRunSelect={handleRunSelect}
        onCompareRuns={handleCompareRuns}
        onNewChat={handleNewChat}
        connectionStatus={connectionStatus}
        darkMode={darkMode}
        onToggleTheme={() => setDarkMode((d) => !d)}
      />
      <main className={cn("flex-1", sidebarCollapsed ? "" : "md:ml-0")}>
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
