import { SharedUiNavigation } from "@/components/shared-ui/SharedUiNavigation";
import { Button } from "@/components/ui/button";
import type { ConnectionStatus } from "@/hooks/use-daemon-events";
import { cn } from "@/lib/utils";
import { Moon, PanelLeftClose, Plus, Sun } from "lucide-react";
import type { UiSurfaceBundle } from "../../../../conformance/ui-surface.generated";
import { ProjectSelector } from "./ProjectSelector";

export function Sidebar({
  collapsed,
  onToggle,
  onNewChat,
  connectionStatus,
  darkMode,
  onToggleTheme,
  uiBundle,
  uiLoading,
  uiError,
  selectedSurfaceId,
  onSurfaceSelect,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  connectionStatus: ConnectionStatus;
  darkMode: boolean;
  onToggleTheme: () => void;
  uiBundle: UiSurfaceBundle | undefined;
  uiLoading: boolean;
  uiError: Error | null;
  selectedSurfaceId: string | null;
  onSurfaceSelect: (surfaceId: string) => void;
}) {
  return (
    <>
      <button
        type="button"
        className={cn(
          "sidebar-overlay fixed inset-0 z-30 bg-black/50 md:hidden",
          collapsed && "hidden",
        )}
        onClick={onToggle}
        aria-label="Close navigation"
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-border bg-card transition-transform motion-reduce:transition-none md:relative md:translate-x-0",
          collapsed && "-translate-x-full",
        )}
      >
        <div className="flex min-h-12 items-center justify-between border-b border-border px-3 py-2">
          <div>
            <h1 className="text-lg font-bold tracking-tight">KOTA</h1>
            <p className="text-[11px] text-muted-foreground">
              Operator surfaces
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            onClick={onNewChat}
            title="New chat"
          >
            <Plus aria-hidden="true" />
            <span className="sr-only">New chat</span>
          </Button>
        </div>

        <ProjectSelector />

        <SharedUiNavigation
          bundle={uiBundle}
          loading={uiLoading}
          error={uiError}
          selectedSurfaceId={selectedSurfaceId}
          onSelect={onSurfaceSelect}
        />

        <div className="flex min-h-12 items-center gap-2 border-t border-border px-3 py-2">
          <span
            className={cn(
              "size-2 rounded-full",
              connectionStatus === "connected"
                ? "bg-success"
                : connectionStatus === "reconnecting"
                  ? "bg-warning"
                  : "bg-destructive",
            )}
            title={connectionStatus}
          />
          <span className="text-xs capitalize text-muted-foreground">
            {connectionStatus}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            onClick={onToggleTheme}
            title="Toggle theme"
          >
            {darkMode ? (
              <Sun aria-hidden="true" />
            ) : (
              <Moon aria-hidden="true" />
            )}
            <span className="sr-only">Toggle theme</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-11"
            onClick={onToggle}
            title="Toggle sidebar"
          >
            <PanelLeftClose aria-hidden="true" />
            <span className="sr-only">Toggle sidebar</span>
          </Button>
        </div>
      </aside>
    </>
  );
}
