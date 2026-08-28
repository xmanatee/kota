import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";
import type { UiNode } from "../../../../conformance/ui-surface.generated";
import { SharedUiAction } from "./SharedUiAction";
import { SharedUiNodeSection } from "./SharedUiNodeSection";
import { SharedUiTable } from "./SharedUiTable";
import { assertNever, roleClass } from "./ui-render-utils";

type DataNode = Extract<
  UiNode,
  {
    kind:
      | "navigation"
      | "status-summary"
      | "metrics"
      | "text"
      | "link"
      | "list"
      | "table";
  }
>;

export function SharedUiDataNode({
  node,
  onNavigate,
  onSessionSelect,
}: {
  node: DataNode;
  onNavigate: (surfaceId: string) => void;
  onSessionSelect: (sessionId: string) => void;
}) {
  switch (node.kind) {
    case "navigation":
      return (
        <SharedUiNodeSection kind={node.kind} title={node.label}>
          <div className="flex flex-wrap gap-2">
            {node.items.map((item) => (
              <Button
                key={item.surfaceId}
                type="button"
                size="sm"
                className="min-h-11"
                variant="outline"
                onClick={() => onNavigate(item.surfaceId)}
                data-surface-id={item.surfaceId}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </SharedUiNodeSection>
      );
    case "status-summary":
      return (
        <section
          className="grid border-y border-border sm:grid-cols-2 xl:grid-cols-3"
          data-node-kind={node.kind}
          aria-label="Status summary"
        >
          {node.entries.map((entry, index) => (
            <dl
              key={`${entry.label}:${entry.value}:${index}`}
              className="flex min-w-0 items-baseline justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0 sm:border-r"
            >
              <dt className="text-xs font-medium text-muted-foreground">
                {entry.label}
              </dt>
              <dd
                className={cn(
                  "truncate text-sm font-semibold",
                  roleClass(entry.role),
                )}
              >
                {entry.value}
              </dd>
            </dl>
          ))}
        </section>
      );
    case "metrics":
      return (
        <SharedUiNodeSection kind={node.kind} title={node.title}>
          <dl className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 xl:grid-cols-3">
            {node.metrics.map((metric, index) => (
              <div
                key={`${metric.label}:${index}`}
                className="bg-background p-4"
              >
                <dt className="text-xs text-muted-foreground">
                  {metric.label}
                </dt>
                <dd
                  className={cn(
                    "mt-1 text-2xl font-semibold",
                    roleClass(metric.role),
                  )}
                >
                  {metric.value}
                  {metric.unit ? (
                    <span className="ml-1 text-sm font-normal text-muted-foreground">
                      {metric.unit}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </SharedUiNodeSection>
      );
    case "text":
      return (
        <SharedUiNodeSection kind={node.kind} title={node.title}>
          <p
            className={cn(
              "max-w-[72ch] text-sm leading-6",
              roleClass(node.role),
            )}
          >
            {node.body}
          </p>
        </SharedUiNodeSection>
      );
    case "link": {
      const linkedSurfaceId =
        node.target.kind === "surface" ? node.target.surfaceId : null;
      const linkedSessionId =
        node.target.kind === "session" ? node.target.sessionId : null;
      return (
        <section data-node-kind={node.kind}>
          {linkedSurfaceId !== null ? (
            <Button
              type="button"
              variant="link"
              className={roleClass(node.role)}
              onClick={() => onNavigate(linkedSurfaceId)}
            >
              {node.label}
            </Button>
          ) : linkedSessionId !== null ? (
            <Button
              type="button"
              variant="link"
              className={roleClass(node.role)}
              onClick={() => onSessionSelect(linkedSessionId)}
            >
              {node.label}
            </Button>
          ) : (
            <a
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                roleClass(node.role ?? "info"),
              )}
              href={linkHref(node)}
              target="_blank"
              rel="noreferrer"
            >
              {node.label}
              <ExternalLink aria-hidden="true" />
            </a>
          )}
        </section>
      );
    }
    case "list":
      return (
        <SharedUiNodeSection kind={node.kind} title={node.title}>
          {node.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {node.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        roleClass(item.role),
                      )}
                    >
                      {item.title}
                    </p>
                    <p className="mt-1 break-words text-sm text-muted-foreground">
                      {item.detail}
                    </p>
                  </div>
                  {item.action ? (
                    <div className="shrink-0">
                      <SharedUiAction action={item.action} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </SharedUiNodeSection>
      );
    case "table":
      return (
        <SharedUiNodeSection kind={node.kind} title={node.title}>
          <SharedUiTable key={node.title} node={node} />
        </SharedUiNodeSection>
      );
    default:
      return assertNever(node);
  }
}

function linkHref(node: Extract<UiNode, { kind: "link" }>): string {
  switch (node.target.kind) {
    case "surface":
      return `#surface/${encodeURIComponent(node.target.surfaceId)}`;
    case "session":
      return `#session/${encodeURIComponent(node.target.sessionId)}`;
    case "daemon-route":
      return node.target.path;
    case "external-url":
      return node.target.url;
    default:
      return assertNever(node.target);
  }
}
