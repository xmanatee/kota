import { Button } from "@/components/ui/button";
import type { ConnectionStatus } from "@/hooks/use-daemon-events";
import { cn } from "@/lib/utils";
import { ActiveSessionsPanel } from "./ActiveSessionsPanel";
import { ApprovalList } from "./ApprovalList";
import { AuditPanel } from "./AuditPanel";
import { ConfigPanel } from "./ConfigPanel";
import { CostPanel } from "./CostPanel";
import { HistoryList } from "./HistoryList";
import { KnowledgePanel } from "./KnowledgePanel";
import { MemoryPanel } from "./MemoryPanel";
import { ModulesPanel } from "./ModulesPanel";
import { OverviewPanel } from "./OverviewPanel";
import { OwnerQuestionsPanel } from "./OwnerQuestionsPanel";
import { SchedulesPanel } from "./SchedulesPanel";
import { SessionList } from "./SessionList";
import { SidebarSection } from "./SidebarSection";
import { TaskPanel } from "./TaskPanel";
import { WorkflowDefinitionsPanel } from "./WorkflowDefinitionsPanel";
import { WorkflowPanel } from "./WorkflowPanel";

export function Sidebar({
  collapsed,
  onToggle,
  activeSessionId,
  onSessionSelect,
  onHistorySelect,
  onRunSelect,
  onNewChat,
  connectionStatus,
  darkMode,
  onToggleTheme,
}: {
  collapsed: boolean;
  onToggle: () => void;
  activeSessionId: string | null;
  onSessionSelect: (id: string) => void;
  onHistorySelect: (id: string) => void;
  onRunSelect: (id: string) => void;
  onNewChat: () => void;
  connectionStatus: ConnectionStatus;
  darkMode: boolean;
  onToggleTheme: () => void;
}) {
  return (
    <>
      <div
        className={cn(
          "sidebar-overlay fixed inset-0 z-30 bg-black/50 md:hidden",
          collapsed && "hidden",
        )}
        onClick={onToggle}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-border bg-card transition-transform md:relative md:translate-x-0",
          collapsed && "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h1 className="text-lg font-bold">KOTA</h1>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onNewChat}
            title="New chat"
          >
            +
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <SidebarSection title="Overview">
            <OverviewPanel />
          </SidebarSection>

          <SidebarSection title="Sessions">
            <SessionList
              activeSessionId={activeSessionId}
              onSelect={onSessionSelect}
            />
          </SidebarSection>

          <SidebarSection title="History" defaultOpen={false}>
            <HistoryList onSelect={onHistorySelect} />
          </SidebarSection>

          <SidebarSection title="Approvals">
            <ApprovalList />
          </SidebarSection>

          <SidebarSection title="Owner Questions">
            <OwnerQuestionsPanel />
          </SidebarSection>

          <SidebarSection title="Tasks">
            <TaskPanel />
          </SidebarSection>

          <SidebarSection title="Workflows">
            <WorkflowPanel onRunSelect={onRunSelect} />
          </SidebarSection>

          <SidebarSection title="Active Sessions" defaultOpen={false}>
            <ActiveSessionsPanel />
          </SidebarSection>

          <SidebarSection title="Workflow Definitions" defaultOpen={false}>
            <WorkflowDefinitionsPanel />
          </SidebarSection>

          <SidebarSection title="Schedules" defaultOpen={false}>
            <SchedulesPanel />
          </SidebarSection>

          <SidebarSection title="Analytics" defaultOpen={false}>
            <CostPanel />
          </SidebarSection>

          <SidebarSection title="Knowledge" defaultOpen={false}>
            <KnowledgePanel />
          </SidebarSection>

          <SidebarSection title="Memory" defaultOpen={false}>
            <MemoryPanel />
          </SidebarSection>

          <SidebarSection title="Guardrail Audit" defaultOpen={false}>
            <AuditPanel />
          </SidebarSection>

          <SidebarSection title="Modules" defaultOpen={false}>
            <ModulesPanel />
          </SidebarSection>

          <SidebarSection title="Config" defaultOpen={false}>
            <ConfigPanel />
          </SidebarSection>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              connectionStatus === "connected"
                ? "bg-green-500"
                : connectionStatus === "reconnecting"
                  ? "bg-yellow-500"
                  : "bg-red-500",
            )}
            title={connectionStatus}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onToggleTheme}
            title="Toggle theme"
          >
            {darkMode ? "\u2600" : "\u263E"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7"
            onClick={onToggle}
            title="Toggle sidebar"
          >
            \u2630
          </Button>
        </div>
      </aside>
    </>
  );
}
