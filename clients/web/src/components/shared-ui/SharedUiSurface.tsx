import { Badge } from "@/components/ui/badge";
import type { UiSurface } from "../../../../conformance/ui-surface.generated";
import type { LiveUiLogEntries } from "../../hooks/use-daemon-events";
import { SharedUiAction } from "./SharedUiAction";
import { SharedUiNode } from "./SharedUiNode";
import {
  conditionLabel,
  embeddedActionIds,
  permissionLabel,
  referencedActionIds,
} from "./ui-render-utils";

export function SharedUiSurface({
  surface,
  onNavigate,
  onSessionSelect = () => {},
  liveLogEntries = {},
}: {
  surface: UiSurface;
  onNavigate: (surfaceId: string) => void;
  onSessionSelect?: (sessionId: string) => void;
  liveLogEntries?: LiveUiLogEntries;
}) {
  const referenced = referencedActionIds(surface.nodes);
  const embedded = embeddedActionIds(surface.nodes);
  const additionalActions = surface.actions.filter(
    (action) => !referenced.has(action.actionId),
  );

  return (
    <article
      className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-10"
      data-surface-id={surface.surfaceId}
      data-extension-id={surface.extensionId}
      data-intent={surface.intent}
      data-attachment-kind={surface.attachmentPoint.kind}
    >
      <header className="flex flex-col gap-4 border-b border-border pb-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{surface.intent}</Badge>
          <span>{surface.extensionId}</span>
          <span aria-hidden="true">·</span>
          <span>{surface.scopeId}</span>
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {surface.title}
          </h1>
          <p className="mt-2 max-w-[72ch] text-sm text-muted-foreground">
            Shared operator surface rendered from {surface.protocolVersion}.
          </p>
        </div>
        {surface.conditions?.length || surface.permissions?.length ? (
          <div
            className="flex flex-wrap gap-2"
            aria-label="Surface requirements"
          >
            {surface.conditions?.map((condition, index) => (
              <Badge
                key={`${conditionLabel(condition)}-${index}`}
                variant="secondary"
              >
                {conditionLabel(condition)}
              </Badge>
            ))}
            {surface.permissions?.map((permission, index) => (
              <Badge
                key={`${permissionLabel(permission)}-${index}`}
                variant="outline"
              >
                {permissionLabel(permission)}
              </Badge>
            ))}
          </div>
        ) : null}
      </header>

      {surface.nodes.map((node, index) => (
        <SharedUiNode
          key={`${node.kind}-${index}`}
          node={node}
          onNavigate={onNavigate}
          onSessionSelect={onSessionSelect}
          hiddenActionIds={embedded}
          liveLogEntries={liveLogEntries}
        />
      ))}

      {additionalActions.length > 0 ? (
        <section
          className="flex flex-col gap-3 border-t border-border pt-6"
          data-node-kind="surface-actions"
        >
          <h2 className="text-sm font-semibold">Available actions</h2>
          <div className="grid gap-2 lg:grid-cols-2">
            {additionalActions.map((action) => (
              <SharedUiAction key={action.actionId} action={action} />
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}
