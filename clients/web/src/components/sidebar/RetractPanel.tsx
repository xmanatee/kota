import { api } from "@/api/client";
import {
  RETRACT_TARGET_ORDER,
  type RetractRecord,
  type RetractRequest,
  type RetractResult,
  type RetractTarget,
} from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, type ReactElement, useState } from "react";

const TARGET_BADGE_VARIANT: Record<
  RetractTarget,
  "default" | "secondary" | "success" | "warning" | "running"
> = {
  knowledge: "default",
  memory: "secondary",
  tasks: "warning",
  inbox: "running",
};

type IdentifierLabel = "id" | "slug" | "path";

function identifierLabelFor(target: RetractTarget): IdentifierLabel {
  switch (target) {
    case "memory":
      return "id";
    case "knowledge":
      return "slug";
    case "tasks":
      return "id";
    case "inbox":
      return "path";
  }
}

function identifierPlaceholderFor(target: RetractTarget): string {
  switch (target) {
    case "memory":
      return "memory id (e.g. mem-7)";
    case "knowledge":
      return "knowledge slug";
    case "tasks":
      return "task id (filename without .md)";
    case "inbox":
      return "data/inbox/note-foo.md";
  }
}

function buildRetractRequest(
  target: RetractTarget,
  identifier: string,
): RetractRequest {
  switch (target) {
    case "memory":
      return { target: "memory", id: identifier };
    case "knowledge":
      return { target: "knowledge", slug: identifier };
    case "tasks":
      return { target: "tasks", id: identifier };
    case "inbox":
      return { target: "inbox", path: identifier };
  }
}

export function RetractPanel() {
  const [target, setTarget] = useState<RetractTarget>("memory");
  const [identifier, setIdentifier] = useState("");
  const [confirming, setConfirming] = useState(false);
  const retract = useMutation<RetractResult, Error, RetractRequest>({
    mutationFn: (request) => api.retract(request),
  });

  function changeTarget(next: RetractTarget): void {
    setTarget(next);
    setIdentifier("");
    setConfirming(false);
  }

  function changeIdentifier(next: string): void {
    setIdentifier(next);
    setConfirming(false);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = identifier.trim();
    if (trimmed === "") return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    retract.mutate(buildRetractRequest(target, trimmed));
  }

  function cancelConfirmation(): void {
    setConfirming(false);
  }

  const trimmed = identifier.trim();
  const label = identifierLabelFor(target);
  const submitDisabled = trimmed === "" || retract.isPending;

  return (
    <div className="space-y-1.5">
      <form className="space-y-1.5" onSubmit={onSubmit}>
        <div className="flex gap-1.5">
          <Select
            className="h-7 flex-1 text-xs"
            value={target}
            onChange={(e) => changeTarget(e.target.value as RetractTarget)}
            aria-label="Retract target"
          >
            {RETRACT_TARGET_ORDER.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <Input
          className="h-7 text-xs"
          placeholder={identifierPlaceholderFor(target)}
          value={identifier}
          onChange={(e) => changeIdentifier(e.target.value)}
          aria-label={`Retract ${label}`}
        />
        {confirming ? (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">
              Confirm retract of {target} {label} <code>{trimmed}</code>?
            </div>
            <div className="flex gap-1.5">
              <Button
                type="submit"
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                disabled={submitDisabled}
              >
                {retract.isPending ? "..." : "Confirm retract"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={cancelConfirmation}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={submitDisabled}
            >
              Retract
            </Button>
          </div>
        )}
      </form>

      {retract.isError && (
        <div className="text-xs text-destructive">{retract.error.message}</div>
      )}

      {retract.data && <RetractResultView result={retract.data} />}
    </div>
  );
}

function RetractResultView({
  result,
}: {
  result: RetractResult;
}): ReactElement {
  if (result.ok) {
    return <RetractSuccessRow record={result.record} />;
  }
  switch (result.reason) {
    case "no_contributors":
      return (
        <div className="text-xs text-muted-foreground">
          Retract unavailable — no contributors registered for the named target.
        </div>
      );
    case "not_found":
      return (
        <div className="flex items-start gap-1.5 text-xs">
          <Badge
            variant={TARGET_BADGE_VARIANT[result.target]}
            className="h-5 shrink-0 text-[10px]"
          >
            {result.target}
          </Badge>
          <div className="min-w-0 flex-1 text-muted-foreground">
            <div className="truncate font-mono text-[10px]">
              {result.identifier}
            </div>
            <div>no record found</div>
          </div>
        </div>
      );
    case "contributor_failed":
      return (
        <div className="flex items-start gap-1.5 text-xs">
          <Badge
            variant={TARGET_BADGE_VARIANT[result.target]}
            className="h-5 shrink-0 text-[10px]"
          >
            {result.target}
          </Badge>
          <div className="min-w-0 flex-1 text-destructive">
            {result.message}
          </div>
        </div>
      );
  }
}

function RetractSuccessRow({ record }: { record: RetractRecord }) {
  return (
    <div className="flex items-start gap-1.5 text-xs">
      <Badge
        variant={TARGET_BADGE_VARIANT[record.target]}
        className="h-5 shrink-0 text-[10px]"
      >
        {record.target}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {record.recordId}
        </div>
        <RetractDetailLine record={record} />
      </div>
    </div>
  );
}

function RetractDetailLine({ record }: { record: RetractRecord }) {
  switch (record.target) {
    case "memory":
    case "knowledge":
      return null;
    case "tasks":
      return (
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="h-4 text-[10px]">
            {record.toState}
          </Badge>
          <span className="truncate text-[10px] text-muted-foreground">
            {record.previousPath} → {record.path}
          </span>
        </div>
      );
    case "inbox":
      return (
        <div className="truncate text-[10px] text-muted-foreground">
          {record.path}
        </div>
      );
  }
}
