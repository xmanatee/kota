import type { ReactNode } from "react";
import type { UiNode } from "../../../../conformance/ui-surface.generated";

export function SharedUiNodeSection({
  kind,
  title,
  children,
}: {
  kind: UiNode["kind"];
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3" data-node-kind={kind}>
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}
