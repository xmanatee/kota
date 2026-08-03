import { cn } from "@/lib/utils";
import { RadioTower } from "lucide-react";
import { useId, useState } from "react";
import type {
  UiNode,
  UiTab,
} from "../../../../conformance/ui-surface.generated";
import type { LiveUiLogEntries } from "../../hooks/use-daemon-events";
import { SharedUiAction } from "./SharedUiAction";
import { SharedUiDataNode } from "./SharedUiDataNode";
import { SharedUiLogEntries } from "./SharedUiLogEntries";
import { SharedUiNodeSection } from "./SharedUiNodeSection";
import { assertNever, roleClass } from "./ui-render-utils";

export function SharedUiNode({
  node,
  onNavigate,
  onSessionSelect = () => {},
  hiddenActionIds = new Set(),
  liveLogEntries = {},
}: {
  node: UiNode;
  onNavigate: (surfaceId: string) => void;
  onSessionSelect?: (sessionId: string) => void;
  hiddenActionIds?: ReadonlySet<string>;
  liveLogEntries?: LiveUiLogEntries;
}) {
  switch (node.kind) {
    case "navigation":
    case "status-summary":
    case "metrics":
    case "text":
    case "link":
    case "tabs":
    case "list":
    case "table":
      if (node.kind !== "tabs") {
        return (
          <SharedUiDataNode
            node={node}
            onNavigate={onNavigate}
            onSessionSelect={onSessionSelect}
          />
        );
      }
      return (
        <UiTabs
          node={node}
          onNavigate={onNavigate}
          onSessionSelect={onSessionSelect}
          hiddenActionIds={hiddenActionIds}
          liveLogEntries={liveLogEntries}
        />
      );
    case "detail":
      return (
        <SharedUiNodeSection kind={node.kind} title={node.title}>
          <p className="max-w-[72ch] whitespace-pre-wrap text-sm leading-6">
            {node.body}
          </p>
        </SharedUiNodeSection>
      );
    case "progress": {
      const percent =
        node.max > 0 ? Math.min(100, (node.value / node.max) * 100) : 0;
      return (
        <section className="flex flex-col gap-2" data-node-kind={node.kind}>
          <div className="flex items-center justify-between gap-4 text-sm">
            <span>{node.label}</span>
            <span className={cn("text-xs", roleClass(node.role))}>
              {node.value} / {node.max}
            </span>
          </div>
          <progress
            className="h-2 w-full overflow-hidden rounded-full accent-primary"
            value={Math.max(
              0,
              Math.min(node.value, node.max > 0 ? node.max : 1),
            )}
            max={node.max > 0 ? node.max : 1}
            aria-label={node.label}
          >
            {percent}%
          </progress>
        </section>
      );
    }
    case "log":
      return (
        <SharedUiNodeSection kind={node.kind} title={node.title}>
          <SharedUiLogEntries entries={node.entries} />
        </SharedUiNodeSection>
      );
    case "log-stream":
      return (
        <SharedUiNodeSection kind={node.kind} title={node.title}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <RadioTower aria-hidden="true" />
            <span>Live from {node.source.path}</span>
            <span>·</span>
            <span>{node.source.eventTypes.join(", ")}</span>
          </div>
          <SharedUiLogEntries
            entries={[
              ...node.entries,
              ...(liveLogEntries[node.streamId] ?? []),
            ]}
          />
        </SharedUiNodeSection>
      );
    case "form":
      return (
        <SharedUiNodeSection kind={node.kind} title={node.title}>
          <SharedUiAction action={node.submit} fields={node.fields} expanded />
        </SharedUiNodeSection>
      );
    case "action-list":
      return (
        <SharedUiNodeSection kind={node.kind} title={node.title}>
          <div className="grid gap-2 lg:grid-cols-2">
            {node.actions
              .filter((action) => !hiddenActionIds.has(action.actionId))
              .map((action) => (
                <SharedUiAction key={action.actionId} action={action} />
              ))}
            {node.actions.length > 0 &&
            node.actions.every((action) =>
              hiddenActionIds.has(action.actionId),
            ) ? (
              <p className="text-sm text-muted-foreground">
                Actions are shown with their related content.
              </p>
            ) : node.actions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No actions available.
              </p>
            ) : null}
          </div>
        </SharedUiNodeSection>
      );
    case "command":
      return (
        <section data-node-kind={node.kind}>
          <SharedUiAction action={node.action} />
        </section>
      );
    case "empty":
      return (
        <section
          className="flex flex-col items-start gap-3 rounded-md border border-border bg-muted/30 p-5"
          data-node-kind={node.kind}
        >
          <div>
            <h3 className="text-sm font-semibold">{node.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{node.detail}</p>
          </div>
          <SharedUiAction action={node.action} />
        </section>
      );
    case "error":
      return (
        <section
          className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-5"
          data-node-kind={node.kind}
          role="alert"
        >
          <div>
            <h3 className="text-sm font-semibold text-destructive">
              {node.title}
            </h3>
            <p className="mt-1 text-sm">{node.detail}</p>
          </div>
          <SharedUiAction action={node.action} />
        </section>
      );
    default:
      return assertNever(node);
  }
}

function UiTabs({
  node,
  onNavigate,
  onSessionSelect,
  hiddenActionIds,
  liveLogEntries,
}: {
  node: Extract<UiNode, { kind: "tabs" }>;
  onNavigate: (surfaceId: string) => void;
  onSessionSelect: (sessionId: string) => void;
  hiddenActionIds: ReadonlySet<string>;
  liveLogEntries: LiveUiLogEntries;
}) {
  const initial = node.tabs.some((tab) => tab.id === node.activeTabId)
    ? node.activeTabId
    : node.tabs[0]?.id;
  const [activeTabId, setActiveTabId] = useState(initial);
  const activeTab = node.tabs.find((tab) => tab.id === activeTabId);
  const tabsId = useId();

  return (
    <SharedUiNodeSection kind={node.kind} title={node.title}>
      <div
        className="flex max-w-full gap-1 overflow-x-auto border-b border-border"
        role="tablist"
        aria-label={node.title}
      >
        {node.tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeTabId}
            id={`${tabsId}-tab-${tab.id}`}
            aria-controls={`${tabsId}-panel-${tab.id}`}
            className={cn(
              "min-h-11 shrink-0 border-b-2 px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              tab.id === activeTabId
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTabId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab ? (
        <TabPanel
          tab={activeTab}
          tabsId={tabsId}
          onNavigate={onNavigate}
          onSessionSelect={onSessionSelect}
          hiddenActionIds={hiddenActionIds}
          liveLogEntries={liveLogEntries}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No tab content.</p>
      )}
    </SharedUiNodeSection>
  );
}

function TabPanel({
  tab,
  tabsId,
  onNavigate,
  onSessionSelect,
  hiddenActionIds,
  liveLogEntries,
}: {
  tab: UiTab;
  tabsId: string;
  onNavigate: (surfaceId: string) => void;
  onSessionSelect: (sessionId: string) => void;
  hiddenActionIds: ReadonlySet<string>;
  liveLogEntries: LiveUiLogEntries;
}) {
  return (
    <div
      id={`${tabsId}-panel-${tab.id}`}
      role="tabpanel"
      aria-labelledby={`${tabsId}-tab-${tab.id}`}
      className="flex flex-col gap-5 py-2"
    >
      {tab.nodes.map((node, index) => (
        <SharedUiNode
          key={`${node.kind}-${index}`}
          node={node}
          onNavigate={onNavigate}
          onSessionSelect={onSessionSelect}
          hiddenActionIds={hiddenActionIds}
          liveLogEntries={liveLogEntries}
        />
      ))}
    </div>
  );
}
