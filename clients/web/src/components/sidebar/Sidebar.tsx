import { Button } from "@/components/ui/button";
import type { ConnectionStatus } from "@/hooks/use-daemon-events";
import { cn } from "@/lib/utils";
import {
  Activity,
  BookOpen,
  BriefcaseBusiness,
  ChevronRight,
  Inbox,
  Moon,
  PanelLeftClose,
  Plus,
  Settings,
  Sun,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { ActiveSessionsPanel } from "./ActiveSessionsPanel";
import { AnswerHistoryPanel } from "./AnswerHistoryPanel";
import { AnswerPanel } from "./AnswerPanel";
import { ApprovalList } from "./ApprovalList";
import { AttentionPanel } from "./AttentionPanel";
import { AuditPanel } from "./AuditPanel";
import { BlockedWorkPanel } from "./BlockedWorkPanel";
import { CapturePanel } from "./CapturePanel";
import { ConfigPanel } from "./ConfigPanel";
import { CostPanel } from "./CostPanel";
import { DigestPanel } from "./DigestPanel";
import { HistoryList } from "./HistoryList";
import { KnowledgePanel } from "./KnowledgePanel";
import { MemoryPanel } from "./MemoryPanel";
import { ModulesPanel } from "./ModulesPanel";
import { OverviewPanel } from "./OverviewPanel";
import { OwnerQuestionsPanel } from "./OwnerQuestionsPanel";
import { ProjectSelector } from "./ProjectSelector";
import { RecallPanel } from "./RecallPanel";
import { RetractPanel } from "./RetractPanel";
import { SchedulesPanel } from "./SchedulesPanel";
import { SessionList } from "./SessionList";
import { SidebarSection } from "./SidebarSection";
import { TaskPanel } from "./TaskPanel";
import { WorkflowDefinitionsPanel } from "./WorkflowDefinitionsPanel";
import { WorkflowPanel } from "./WorkflowPanel";

const INTENT_GROUPS = [
  "Status",
  "Inbox",
  "Work",
  "Knowledge",
  "Setup",
] as const;

export function Sidebar({
  collapsed,
  onToggle,
  activeSessionId,
  onSessionSelect,
  onHistorySelect,
  onRunSelect,
  onCompareRuns,
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
  onCompareRuns: (idA: string, idB: string) => void;
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
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">New chat</span>
          </Button>
        </div>

        <ProjectSelector />

        <nav className="flex-1 overflow-y-auto" aria-label="Primary navigation">
          <IntentGroup title="Status" icon={Activity} defaultOpen>
            <OverviewPanel />
          </IntentGroup>

          <IntentGroup title="Inbox" icon={Inbox} defaultOpen>
            <IntentSubsection title="Approvals">
              <ApprovalList />
            </IntentSubsection>

            <IntentSubsection title="Owner questions">
              <OwnerQuestionsPanel />
            </IntentSubsection>

            <IntentSubsection title="Blocked work">
              <BlockedWorkPanel />
            </IntentSubsection>

            <IntentSubsection title="Attention">
              <AttentionPanel />
            </IntentSubsection>
          </IntentGroup>

          <IntentGroup title="Work" icon={BriefcaseBusiness}>
            <SidebarSection title="Tasks">
              <TaskPanel />
            </SidebarSection>

            <SidebarSection title="Sessions">
              <SessionList
                activeSessionId={activeSessionId}
                onSelect={onSessionSelect}
              />
            </SidebarSection>

            <SidebarSection title="Workflows">
              <WorkflowPanel
                onRunSelect={onRunSelect}
                onCompareRuns={onCompareRuns}
              />
            </SidebarSection>

            <SidebarSection title="Active sessions" defaultOpen={false}>
              <ActiveSessionsPanel />
            </SidebarSection>

            <SidebarSection title="Workflow definitions" defaultOpen={false}>
              <WorkflowDefinitionsPanel />
            </SidebarSection>

            <SidebarSection title="Schedules" defaultOpen={false}>
              <SchedulesPanel />
            </SidebarSection>

            <SidebarSection title="Analytics" defaultOpen={false}>
              <CostPanel />
            </SidebarSection>
          </IntentGroup>

          <IntentGroup title="Knowledge" icon={BookOpen}>
            <SidebarSection title="Recall">
              <RecallPanel />
            </SidebarSection>

            <SidebarSection title="Answer" defaultOpen={false}>
              <AnswerPanel />
            </SidebarSection>

            <SidebarSection title="Answer history" defaultOpen={false}>
              <AnswerHistoryPanel />
            </SidebarSection>

            <SidebarSection title="Capture" defaultOpen={false}>
              <CapturePanel />
            </SidebarSection>

            <SidebarSection title="Retract" defaultOpen={false}>
              <RetractPanel />
            </SidebarSection>

            <SidebarSection title="Knowledge" defaultOpen={false}>
              <KnowledgePanel />
            </SidebarSection>

            <SidebarSection title="Memory" defaultOpen={false}>
              <MemoryPanel />
            </SidebarSection>

            <SidebarSection title="History" defaultOpen={false}>
              <HistoryList onSelect={onHistorySelect} />
            </SidebarSection>

            <SidebarSection title="Digest" defaultOpen={false}>
              <DigestPanel />
            </SidebarSection>
          </IntentGroup>

          <IntentGroup title="Setup" icon={Settings}>
            <SidebarSection title="Modules">
              <ModulesPanel />
            </SidebarSection>

            <SidebarSection title="Config" defaultOpen={false}>
              <ConfigPanel />
            </SidebarSection>

            <SidebarSection title="Guardrail audit" defaultOpen={false}>
              <AuditPanel />
            </SidebarSection>
          </IntentGroup>
        </nav>

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
            {darkMode ? (
              <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="sr-only">Toggle theme</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7"
            onClick={onToggle}
            title="Toggle sidebar"
          >
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Toggle sidebar</span>
          </Button>
        </div>
      </aside>
    </>
  );
}

function IntentGroup({
  title,
  icon: Icon,
  children,
  defaultOpen = false,
}: {
  title: (typeof INTENT_GROUPS)[number];
  icon: typeof Activity;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="border-b border-border" data-intent={title}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-semibold hover:bg-accent/60"
        aria-expanded={open}
      >
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span>{title}</span>
        <ChevronRight
          className={cn(
            "ml-auto h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
      </button>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </section>
  );
}

function IntentSubsection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}
