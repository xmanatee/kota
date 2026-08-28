import type { UiSurface } from "../../../../conformance/ui-surface.generated";
import type { LiveUiLogEntries } from "../../hooks/use-daemon-events";
import { SharedUiAction } from "./SharedUiAction";
import { SharedUiNode } from "./SharedUiNode";
import { embeddedActionIds, referencedActionIds } from "./ui-render-utils";

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
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-6 pt-16 sm:px-6 sm:pt-6 lg:px-8"
      data-surface-id={surface.surfaceId}
      data-extension-id={surface.extensionId}
      data-intent={surface.intent}
      data-attachment-kind={surface.attachmentPoint.kind}
    >
      <header className="border-b border-border pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {surface.title}
        </h1>
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
