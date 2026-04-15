import { ChatArea } from "@/components/chat/ChatArea";
import { HistoryView } from "@/components/chat/HistoryView";
import { RunDetail } from "@/components/run-detail/RunDetail";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { useDaemonEvents } from "@/hooks/use-daemon-events";
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
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem("kota-theme");
    return stored
      ? stored === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  const connectionStatus = useDaemonEvents();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("kota-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash.startsWith("run/")) {
      setViewingRunId(hash.slice(4));
    }
  }, []);

  const showChat = useCallback(() => {
    setViewingHistoryId(null);
    setViewingRunId(null);
    window.location.hash = "";
  }, []);

  const handleRunSelect = useCallback((id: string) => {
    setViewingRunId(id);
    setViewingHistoryId(null);
    window.location.hash = `run/${id}`;
  }, []);

  const handleHistorySelect = useCallback((id: string) => {
    setViewingHistoryId(id);
    setViewingRunId(null);
  }, []);

  const handleNewChat = useCallback(() => {
    setSessionId(null);
    showChat();
  }, [showChat]);

  let mainContent: React.ReactNode;
  if (viewingRunId) {
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
        \u2630
      </button>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
        activeSessionId={sessionId}
        onSessionSelect={setSessionId}
        onHistorySelect={handleHistorySelect}
        onRunSelect={handleRunSelect}
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
      <AppContent />
    </QueryClientProvider>
  );
}
