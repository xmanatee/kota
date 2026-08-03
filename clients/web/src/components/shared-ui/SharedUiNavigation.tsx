import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Activity,
  BookOpen,
  BriefcaseBusiness,
  ChevronRight,
  Inbox,
  Settings,
} from "lucide-react";
import type {
  UiIntent,
  UiSurfaceBundle,
} from "../../../../conformance/ui-surface.generated";
import { assertNever } from "./ui-render-utils";

export function SharedUiNavigation({
  bundle,
  loading,
  error,
  selectedSurfaceId,
  onSelect,
}: {
  bundle: UiSurfaceBundle | undefined;
  loading: boolean;
  error: Error | null;
  selectedSurfaceId: string | null;
  onSelect: (surfaceId: string) => void;
}) {
  if (loading) {
    return (
      <output className="flex flex-col gap-3 p-3">
        <span className="block h-11 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <span className="block h-11 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <span className="block h-11 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <span className="sr-only">Loading shared operator surfaces</span>
      </output>
    );
  }
  if (error) {
    return (
      <div
        className="m-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        role="alert"
      >
        <p className="font-medium text-destructive">Shared UI unavailable</p>
        <p className="mt-1 text-muted-foreground">{error.message}</p>
      </div>
    );
  }
  if (!bundle || bundle.surfaces.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No operator surfaces are contributed for this scope.
      </p>
    );
  }

  const intents = bundle.surfaces.reduce<UiIntent[]>((items, surface) => {
    if (!items.includes(surface.intent)) items.push(surface.intent);
    return items;
  }, []);

  return (
    <nav
      className="flex-1 overflow-y-auto"
      aria-label="Shared operator surfaces"
    >
      {intents.map((intent) => {
        const surfaces = bundle.surfaces.filter(
          (surface) => surface.intent === intent,
        );
        const containsSelected = surfaces.some(
          (surface) => surface.surfaceId === selectedSurfaceId,
        );
        const Icon = intentIcon(intent);
        return (
          <details
            key={intent}
            className="group border-b border-border"
            open={containsSelected || selectedSurfaceId === null}
            data-intent={intent}
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-semibold hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
              <Icon aria-hidden="true" />
              <span>{intent}</span>
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {surfaces.length}
              </span>
              <ChevronRight
                className="transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
            </summary>
            <ul className="flex flex-col gap-1 px-2 pb-2">
              {surfaces.map((surface) => (
                <li key={surface.surfaceId}>
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      "h-auto min-h-11 w-full justify-start whitespace-normal px-2 py-2 text-left",
                      surface.surfaceId === selectedSurfaceId &&
                        "bg-accent text-accent-foreground",
                      surface.attachmentPoint.kind === "surface" && "pl-6",
                    )}
                    aria-current={
                      surface.surfaceId === selectedSurfaceId
                        ? "page"
                        : undefined
                    }
                    onClick={() => onSelect(surface.surfaceId)}
                    data-surface-id={surface.surfaceId}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {surface.title}
                      </span>
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {surface.extensionId}
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </nav>
  );
}

function intentIcon(intent: UiIntent) {
  switch (intent) {
    case "Status":
      return Activity;
    case "Inbox":
      return Inbox;
    case "Work":
      return BriefcaseBusiness;
    case "Knowledge":
      return BookOpen;
    case "Setup":
      return Settings;
    default:
      return assertNever(intent);
  }
}
